import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';

type CreateCheckoutInput = {
  authUserId: string;
  planId: PlanId;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private mono = axios.create({
    baseURL: process.env.MONO_BASE_URL || 'https://api.monobank.ua',
    headers: {
      'X-Token': process.env.MONO_MERCHANT_TOKEN!,
    },
    timeout: 15000,
  });

  private planPriceUahKop(planId: PlanId): number {
    // Постав тут свої реальні ціни (в копійках)
    // На скріні в тебе 399 / 799 грн
    if (planId === 'BASIC') return 39900;
    if (planId === 'PRO') return 79900;
    throw new BadRequestException('Unsupported planId');
  }

  // ====== 1) Create subscription checkout ======
  async createMonobankCheckout(input: CreateCheckoutInput) {
    const user = await this.prisma.user.findUnique({
      where: { authUserId: input.authUserId },
      include: { subscription: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const amount = this.planPriceUahKop(input.planId);

    // interval "1m" = щомісяця :contentReference[oaicite:4]{index=4}
    // response: { subscriptionId, pageUrl } :contentReference[oaicite:5]{index=5}
    const redirectUrl = `${process.env.APP_PUBLIC_URL}/billing/monobank/return`;
    const webHookUrl = `${process.env.API_PUBLIC_URL}${process.env.MONO_WEBHOOK_PATH}`;

    const { data } = await this.mono.post('/api/merchant/subscription/create', {
      amount,
      ccy: 980, // UAH
      redirectUrl,
      webHookUrl,
      interval: '1m',
    });

    const subscriptionId = data?.subscriptionId as string | undefined;
    const pageUrl = data?.pageUrl as string | undefined;

    if (!subscriptionId || !pageUrl) {
      this.logger.error(`Unexpected mono response: ${JSON.stringify(data)}`);
      throw new BadRequestException('Failed to create monobank subscription');
    }

    // збережемо pending стан у себе
    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        planId: PlanId.FREE,
        planIdPending: input.planId,
        monoSubscriptionId: subscriptionId,
        monoStatus: 'created',
        status: 'pending',
      },
      update: {
        planIdPending: input.planId,
        monoSubscriptionId: subscriptionId,
        monoStatus: 'created',
        status: 'pending',
      },
    });

    return { subscriptionId, pageUrl };
  }

  // ====== 2) My subscription ======
  async getMySubscription(authUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) throw new BadRequestException('User not found');

    return { subscription: user.subscription };
  }

  // ====== 3) Webhook handling ======
  async handleMonobankWebhook(req: any) {
    const xSign = req.headers['x-sign'];
    if (!xSign) throw new BadRequestException('Missing X-Sign');

    const rawBody: Buffer = req.body; // bodyParser.raw()
    if (!Buffer.isBuffer(rawBody))
      throw new BadRequestException('Webhook body is not raw buffer');

    const ok = await this.verifyMonobankSignature(rawBody, xSign);
    if (!ok) throw new BadRequestException('Invalid X-Sign');

    const payload = JSON.parse(rawBody.toString('utf8'));
    // payload body "ідентичний відповіді invoice/status" :contentReference[oaicite:6]{index=6}
    // status може прийти не по порядку, орієнтуйся на modifiedDate :contentReference[oaicite:7]{index=7}

    // У webhook для invoice є invoiceId/status/modifiedDate/... :contentReference[oaicite:8]{index=8}
    const status = payload?.status as string | undefined;

    // Тут головна проблема: вебхук про оплату не завжди дає subscriptionId напряму.
    // Тому робимо "safe" стратегію:
    // 1) нічого не ламаємо якщо не можемо звʼязати
    // 2) активуємо план через sync-перевірку subscription/status
    this.logger.log(
      `Mono webhook status=${status} invoiceId=${payload?.invoiceId}`,
    );

    // Тригернемо sync усіх pending підписок (дешево, їх мало)
    await this.syncAllPendingSubscriptions();
  }

  // ====== 4) Sync pending subscriptions by calling /subscription/status ======
  private async syncAllPendingSubscriptions() {
    const pendings = await this.prisma.subscription.findMany({
      where: {
        status: 'pending',
        monoSubscriptionId: { not: null },
        planIdPending: { not: null },
      },
    });

    for (const sub of pendings) {
      try {
        const { data } = await this.mono.get(
          '/api/merchant/subscription/status',
          {
            params: { subscriptionId: sub.monoSubscriptionId },
          },
        );

        // (офіційно є метод subscription/status) :contentReference[oaicite:9]{index=9}
        // Якщо в статусі/історії є успішний платіж — активуємо.
        // Тут назви полів можуть відрізнятися, тому робимо максимально обережно:
        const monoStatus = String(data?.status ?? '');

        // Евристика: якщо subscription/status повертає щось на кшталт "active"/"success"/тощо
        // то активуємо. Ти можеш уточнити за фактичним response в логах.
        const looksActive = /active|success|ok/i.test(monoStatus);

        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: {
            monoStatus,
            ...(looksActive
              ? {
                  planId: sub.planIdPending!,
                  planIdPending: null,
                  status: 'active',
                  currentPeriodStart: new Date(),
                  // грубо +30 днів; можеш рахувати календарно
                  currentPeriodEnd: new Date(
                    Date.now() + 30 * 24 * 60 * 60 * 1000,
                  ),
                }
              : {}),
          },
        });
      } catch (e: any) {
        this.logger.warn(`sync pending failed for ${sub.id}: ${e?.message}`);
      }
    }
  }

  // ====== 5) X-Sign verify ======
  private cachedPubKeyPem: string | null = null;

  private async getMonobankPubKeyPem(): Promise<string> {
    if (this.cachedPubKeyPem) return this.cachedPubKeyPem;

    // GET /api/merchant/pubkey повертає base64 ECDSA pubkey :contentReference[oaicite:10]{index=10}
    const { data } = await this.mono.get('/api/merchant/pubkey');
    const pubKeyBase64 = String(data);

    const pubKeyBytes = Buffer.from(pubKeyBase64, 'base64');
    const pubKeyPem = pubKeyBytes.toString('utf8');

    this.cachedPubKeyPem = pubKeyPem;
    return pubKeyPem;
  }

  private async verifyMonobankSignature(rawBody: Buffer, xSignBase64: string) {
    const pubKeyPem = await this.getMonobankPubKeyPem();
    const signature = Buffer.from(xSignBase64, 'base64');

    // ECDSA over SHA256 :contentReference[oaicite:11]{index=11}
    const verifier = crypto.createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();

    // Важливо: monobank дає DER-підпис (ASN.1), Node verify це підтримує.
    const ok = verifier.verify(pubKeyPem, signature);

    if (!ok) {
      // pubkey може змінитися — тоді онови кеш і спробуй ще раз
      this.cachedPubKeyPem = null;
      const pubKeyPem2 = await this.getMonobankPubKeyPem();

      const verifier2 = crypto.createVerify('SHA256');
      verifier2.update(rawBody);
      verifier2.end();

      return verifier2.verify(pubKeyPem2, signature);
    }

    return ok;
  }
}
