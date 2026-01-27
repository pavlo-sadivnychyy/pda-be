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
    if (planId === 'BASIC') return 1000;
    if (planId === 'PRO') return 90000;
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

    const redirectUrl = `${process.env.APP_PUBLIC_URL}/pricing`;
    const webHookUrl = `${process.env.API_PUBLIC_URL}${process.env.MONO_WEBHOOK_PATH}`;

    const { data } = await this.mono.post('/api/merchant/subscription/create', {
      amount,
      ccy: 980,
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
    const xSign = req.headers['x-sign'] as string | undefined;
    if (!xSign) throw new BadRequestException('Missing X-Sign');

    // ✅ беремо raw bytes, які ми зберегли в main.ts
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException(
        'Webhook rawBody is missing (check main.ts verify)',
      );
    }

    const ok = await this.verifyMonobankSignature(rawBody, xSign);
    if (!ok) throw new BadRequestException('Invalid X-Sign');

    const payload = JSON.parse(rawBody.toString('utf8'));
    const status = payload?.status as string | undefined;

    this.logger.log(
      `Mono webhook: status=${status} invoiceId=${payload?.invoiceId ?? 'n/a'}`,
    );

    // ✅ важливо: оновлюємо не лише pending, а й active (для renew)
    await this.syncSubscriptions();
  }

  // ====== 4) Sync subscriptions by calling /subscription/status ======
  private async syncSubscriptions() {
    // ✅ беремо і pending, і active — щоб продовжувати періоди при щомісячних списаннях
    const subs = await this.prisma.subscription.findMany({
      where: {
        monoSubscriptionId: { not: null },
        OR: [{ status: 'pending' }, { status: 'active' }],
      },
    });

    for (const sub of subs) {
      try {
        const { data } = await this.mono.get(
          '/api/merchant/subscription/status',
          {
            params: { subscriptionId: sub.monoSubscriptionId },
          },
        );

        const monoStatus = String(data?.status ?? '');

        // ✅ дуже практична евристика: активна/успішна підписка
        const looksActive = /active|success|ok/i.test(monoStatus);

        // ✅ якщо стає active і є pending план — активуємо план
        if (looksActive && sub.planIdPending) {
          const now = new Date();
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: {
              monoStatus,
              planId: sub.planIdPending,
              planIdPending: null,
              status: 'active',
              currentPeriodStart: now,
              currentPeriodEnd: new Date(
                now.getTime() + 30 * 24 * 60 * 60 * 1000,
              ),
            },
          });
          continue;
        }

        // ✅ якщо вже active — продовжуємо період (renew)
        if (looksActive && sub.status === 'active' && !sub.planIdPending) {
          const now = new Date();
          const base =
            sub.currentPeriodEnd && sub.currentPeriodEnd > now
              ? sub.currentPeriodEnd
              : now;
          const extended = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: {
              monoStatus,
              currentPeriodEnd: extended,
            },
          });
          continue;
        }

        // інакше просто оновимо статус моно, не чіпаючи план
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { monoStatus },
        });
      } catch (e: any) {
        this.logger.warn(`sync failed for sub=${sub.id}: ${e?.message}`);
      }
    }
  }

  // ====== 5) X-Sign verify ======
  private cachedPubKeyPem: string | null = null;

  private async getMonobankPubKeyPem(): Promise<string> {
    if (this.cachedPubKeyPem) return this.cachedPubKeyPem;

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

    const verifier = crypto.createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();

    const ok = verifier.verify(pubKeyPem, signature);

    if (!ok) {
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
