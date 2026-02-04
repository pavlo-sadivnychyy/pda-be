import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';

type CreateCheckoutInput = {
  authUserId: string;
  planId: PlanId;
};

type SyncTxnInput = {
  authUserId: string;
  transactionId: string;
};

type CancelInput = {
  authUserId: string;
};

type WebhookInput = {
  body: any;
  headers: any;
  rawBody?: Buffer;
};

@Injectable()
export class BillingService {
  private paddle: AxiosInstance;

  constructor(private readonly prisma: PrismaService) {
    const env = (process.env.PADDLE_ENV ?? 'sandbox').toLowerCase();
    const baseURL =
      env === 'production'
        ? 'https://api.paddle.com'
        : 'https://sandbox-api.paddle.com';

    const apiKey = process.env.PADDLE_API_KEY;

    this.paddle = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });
  }

  // ---------------------------
  // helpers
  // ---------------------------
  private getPriceId(planId: PlanId) {
    if (planId === PlanId.BASIC) return process.env.PADDLE_PRICE_BASIC_ID;
    if (planId === PlanId.PRO) return process.env.PADDLE_PRICE_PRO_ID;
    return null;
  }

  private priceIdToPlan(priceId: string | null): PlanId | null {
    if (!priceId) return null;
    if (priceId === process.env.PADDLE_PRICE_BASIC_ID) return PlanId.BASIC;
    if (priceId === process.env.PADDLE_PRICE_PRO_ID) return PlanId.PRO;
    return null;
  }

  private requireEnv(name: string) {
    const v = process.env[name];
    if (!v) throw new InternalServerErrorException(`${name} is not set`);
    return v;
  }

  private toLower(v: any): string {
    return String(v ?? '')
      .toLowerCase()
      .trim();
  }

  private isPaidStatus(status: string) {
    const s = this.toLower(status);
    return s === 'paid' || s === 'completed' || s === 'success';
  }

  private isBadSubscriptionOrPaymentStatus(status: string | null | undefined) {
    const s = this.toLower(status);
    return (
      s === 'past_due' ||
      s === 'past-due' ||
      s === 'paused' ||
      s === 'canceled' ||
      s === 'cancelled' ||
      s === 'unpaid' ||
      s === 'failed' ||
      s === 'expired'
    );
  }

  private extractPeriod(paddleSub: any): {
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
  } {
    const period =
      paddleSub?.current_billing_period ??
      paddleSub?.billing_period ??
      paddleSub?.billing_cycle ??
      null;

    const currentPeriodStart = period?.starts_at
      ? new Date(period.starts_at)
      : null;

    const currentPeriodEnd = period?.ends_at ? new Date(period.ends_at) : null;

    return { currentPeriodStart, currentPeriodEnd };
  }

  private inferCancelAtPeriodEndFromPaddle(paddleSub: any): boolean {
    const scheduled = paddleSub?.scheduled_change ?? null;
    if (!scheduled) return false;

    const action = this.toLower(scheduled?.action);
    const type = this.toLower(scheduled?.type);

    return action === 'cancel' || type === 'cancel';
  }

  private async fetchTransaction(transactionId: string) {
    try {
      const res = await this.paddle.get(`/transactions/${transactionId}`);
      return res?.data?.data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.response?.data?.message ??
          e?.message ??
          'Failed to fetch transaction',
      );
    }
  }

  private async fetchSubscription(subscriptionId: string) {
    try {
      const res = await this.paddle.get(`/subscriptions/${subscriptionId}`);
      return res?.data?.data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.response?.data?.message ??
          e?.message ??
          'Failed to fetch subscription',
      );
    }
  }

  // ---------------------------
  // Paddle webhook verification (manual, HMAC SHA256)
  // Paddle-Signature: ts=...;h1=...
  // signed_payload = `${ts}:${rawBody}`
  // hmac_sha256(secret, signed_payload) hex == h1
  // ---------------------------
  private parsePaddleSignatureHeader(headerValue: string) {
    const parts = headerValue.split(';').map((p) => p.trim());
    const map = new Map<string, string[]>();

    for (const p of parts) {
      const [k, v] = p.split('=');
      if (!k || !v) continue;
      const key = k.trim();
      const val = v.trim();
      const prev = map.get(key) ?? [];
      prev.push(val);
      map.set(key, prev);
    }

    const ts = map.get('ts')?.[0] ?? null;
    const h1s = map.get('h1') ?? [];
    return { ts, h1s };
  }

  private verifyPaddleWebhookOrThrow(
    rawBody: Buffer | undefined,
    headers: any,
  ) {
    const secret = process.env.PADDLE_WEBHOOK_SECRET_KEY;
    if (!secret) {
      throw new InternalServerErrorException(
        'PADDLE_WEBHOOK_SECRET_KEY is not set',
      );
    }

    const sigHeader =
      headers?.['paddle-signature'] ??
      headers?.['Paddle-Signature'] ??
      headers?.['PADDLE-SIGNATURE'];

    if (!sigHeader || typeof sigHeader !== 'string') {
      throw new UnauthorizedException('Missing Paddle-Signature header');
    }

    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new InternalServerErrorException(
        'rawBody is missing. Ensure main.ts uses rawBody:true',
      );
    }

    const { ts, h1s } = this.parsePaddleSignatureHeader(sigHeader);
    if (!ts || !h1s.length) throw new UnauthorizedException('Bad signature');

    // replay protection: 5 minutes tolerance (не 5 секунд, щоб не ловити кривий час на хостингу)
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) throw new UnauthorizedException('Bad ts');

    const nowSec = Math.floor(Date.now() / 1000);
    const toleranceSec = 5 * 60;
    if (Math.abs(nowSec - tsNum) > toleranceSec) {
      throw new UnauthorizedException('Webhook timestamp out of tolerance');
    }

    const signedPayload = Buffer.concat([
      Buffer.from(`${ts}:`, 'utf8'),
      rawBody,
    ]);

    const digest = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    const digestBuf = Buffer.from(digest, 'utf8');

    // може бути кілька h1 при ротації секретів — приймаємо будь-який з них :contentReference[oaicite:4]{index=4}
    const ok = h1s.some((h1) => {
      const h1Buf = Buffer.from(h1, 'utf8');
      if (h1Buf.length !== digestBuf.length) return false;
      return timingSafeEqual(h1Buf, digestBuf);
    });

    if (!ok) throw new UnauthorizedException('Invalid webhook signature');

    // eventKey fallback for idempotency (якщо немає event_id)
    const eventKeyFallback = `ts=${ts};h1=${h1s[0]}`;
    return { eventKeyFallback };
  }

  private async markWebhookProcessedOrThrow(eventKey: string) {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: { provider: 'paddle', eventKey },
      });
      return true;
    } catch (e: any) {
      // unique violation => already processed
      const msg = String(e?.message ?? '');
      if (msg.toLowerCase().includes('unique')) return false;
      // prisma P2002
      if (e?.code === 'P2002') return false;
      throw e;
    }
  }

  // ===============================
  // CREATE CHECKOUT
  // ===============================
  async createCheckout(input: CreateCheckoutInput) {
    const { authUserId, planId } = input;

    if (!authUserId) throw new BadRequestException('authUserId missing');
    if (!planId) throw new BadRequestException('planId missing');
    if (planId === PlanId.FREE)
      throw new BadRequestException('FREE does not require checkout');

    this.requireEnv('PADDLE_API_KEY');
    const frontendUrl = this.requireEnv('APP_PUBLIC_URL');

    const priceId = this.getPriceId(planId);
    if (!priceId)
      throw new InternalServerErrorException('PriceId not configured');

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, planId: PlanId.FREE, status: 'active' },
      update: {},
    });

    let transactionId: string;

    try {
      const res = await this.paddle.post('/transactions', {
        items: [{ price_id: priceId, quantity: 1 }],
        customer: { email: user.email },
        custom_data: { userId: user.id },
        checkout: {
          settings: {
            display_mode: 'wide-overlay',
            success_url: `${frontendUrl}/checkout?result=success`,
            cancel_url: `${frontendUrl}/pricing?checkout=cancel`,
          },
        },
      });

      transactionId = res?.data?.data?.id;
      if (!transactionId) throw new Error('No transaction id');
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.response?.data?.message ??
          e?.message ??
          'Failed to create Paddle transaction',
      );
    }

    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: {
        status: 'pending',
        pendingPlanId: planId,
        paddleTransactionId: transactionId,
        paddleStatus: 'created',
      },
    });

    return { transactionId };
  }

  // ===============================
  // SYNC TRANSACTION (client-driven)
  // ===============================
  async syncTransactionToDb(input: SyncTxnInput) {
    const { authUserId, transactionId } = input;

    if (!authUserId) throw new BadRequestException('authUserId missing');
    if (!transactionId) throw new BadRequestException('transactionId missing');

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user || !user.subscription)
      throw new NotFoundException('Subscription not found');

    const sub = user.subscription;
    const txn = await this.fetchTransaction(transactionId);

    const txnStatus = this.toLower(txn?.status);
    const isPaid = this.isPaidStatus(txnStatus);

    const priceId =
      txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

    const planFromTxn = this.priceIdToPlan(priceId);

    const paddleSubscriptionId =
      txn?.subscription_id ?? txn?.subscription?.id ?? null;

    if (isPaid) {
      const targetPlan = sub.pendingPlanId ?? planFromTxn ?? sub.planId;

      let periodStart: Date | null = null;
      let periodEnd: Date | null = null;

      const subId = paddleSubscriptionId ?? sub.paddleSubscriptionId;
      if (subId) {
        const paddleSub = await this.fetchSubscription(subId);
        const p = this.extractPeriod(paddleSub);
        periodStart = p.currentPeriodStart;
        periodEnd = p.currentPeriodEnd;
      }

      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: {
          status: 'active',
          planId: targetPlan,
          pendingPlanId: null,
          cancelAtPeriodEnd: false,
          paddleStatus: txnStatus,
          paddleTransactionId: transactionId,
          paddleSubscriptionId: subId ?? sub.paddleSubscriptionId,
          paddlePriceId: priceId ?? sub.paddlePriceId,
          ...(periodStart ? { currentPeriodStart: periodStart } : {}),
          ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
        },
      });
    } else {
      // НЕ даунгрейдимо тут на FREE: це може бути "закрив checkout" або разова невдача.
      // downgrade робить cron тільки після periodEnd.
      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: {
          status: 'active',
          pendingPlanId: null,
          paddleStatus: txnStatus,
          paddleTransactionId: transactionId,
        },
      });
    }

    return { ok: true };
  }

  // ===============================
  // CANCEL AT PERIOD END
  // ===============================
  // ===============================
  // CANCEL AT PERIOD END
  // ===============================
  async cancelAtPeriodEnd(input: CancelInput) {
    const { authUserId } = input;
    if (!authUserId) throw new BadRequestException('authUserId missing');

    this.requireEnv('PADDLE_API_KEY');

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user || !user.subscription)
      throw new NotFoundException('Subscription not found');

    const sub = user.subscription;

    // already scheduled
    if (sub.cancelAtPeriodEnd) {
      return {
        ok: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: sub.currentPeriodEnd,
      };
    }

    // ✅ SELF-HEAL: якщо paddleSubscriptionId missing — пробуємо відновити
    let paddleSubscriptionId = sub.paddleSubscriptionId ?? null;

    if (!paddleSubscriptionId) {
      // 1) якщо є paddleTransactionId — витягуємо subscription id з транзакції
      if (sub.paddleTransactionId) {
        const txn = await this.fetchTransaction(sub.paddleTransactionId);

        paddleSubscriptionId =
          txn?.subscription_id ?? txn?.subscription?.id ?? null;

        const priceId =
          txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

        const customerId = txn?.customer_id ?? txn?.customer?.id ?? null;

        await this.prisma.subscription.update({
          where: { userId: sub.userId },
          data: {
            paddleSubscriptionId: paddleSubscriptionId ?? undefined,
            paddlePriceId: priceId ?? undefined,
            paddleCustomerId: customerId ?? undefined,
            paddleStatus:
              String(txn?.status ?? sub.paddleStatus ?? '').toLowerCase() ||
              sub.paddleStatus,
          },
        });
      }
    }

    // якщо все ще немає — значить підписки реально нема
    if (!paddleSubscriptionId) {
      throw new BadRequestException(
        'paddleSubscriptionId is missing (no active Paddle subscription found for this user)',
      );
    }

    // ✅ cancel in Paddle
    let paddleSub: any;
    try {
      const res = await this.paddle.post(
        `/subscriptions/${paddleSubscriptionId}/cancel`,
        { effective_from: 'next_billing_period' },
      );
      paddleSub = res?.data?.data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.response?.data?.message ??
          e?.message ??
          'Failed to cancel subscription in Paddle',
      );
    }

    const period =
      paddleSub?.current_billing_period ??
      paddleSub?.billing_period ??
      paddleSub?.billing_cycle ??
      null;

    const currentPeriodStart = period?.starts_at
      ? new Date(period.starts_at)
      : null;

    const currentPeriodEnd = period?.ends_at ? new Date(period.ends_at) : null;

    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: {
        paddleSubscriptionId,
        cancelAtPeriodEnd: true,
        status: 'active',
        paddleStatus:
          String(paddleSub?.status ?? sub.paddleStatus ?? '').toLowerCase() ||
          sub.paddleStatus,
        ...(currentPeriodStart ? { currentPeriodStart } : {}),
        ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      },
    });

    return {
      ok: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd,
    };
  }

  // ===============================
  // WEBHOOK (verified + idempotent + canonical sync)
  // ===============================
  async handleWebhook(input: WebhookInput) {
    const { body, headers, rawBody } = input;

    // 1) verify signature (throws 401 on fail) :contentReference[oaicite:5]{index=5}
    const { eventKeyFallback } = this.verifyPaddleWebhookOrThrow(
      rawBody,
      headers,
    );

    // 2) build eventKey for idempotency
    const eventId =
      body?.event_id ?? body?.id ?? body?.eventId ?? body?.event?.id ?? null;
    const eventKey = eventId
      ? `evt:${String(eventId)}`
      : `fallback:${eventKeyFallback}`;

    const isFirstTime = await this.markWebhookProcessedOrThrow(eventKey);
    if (!isFirstTime) {
      // already processed -> OK (idempotent)
      return { ok: true, deduped: true };
    }

    const eventType = this.toLower(
      body?.event_type ?? body?.eventType ?? body?.type,
    );

    const data = body?.data ?? body;

    const subscriptionId: string | null =
      data?.subscription_id ??
      data?.subscription?.id ??
      data?.subscriptionId ??
      null;

    const transactionId: string | null =
      data?.transaction_id ??
      data?.transaction?.id ??
      data?.id ??
      data?.transactionId ??
      null;

    const userId: string | null =
      data?.custom_data?.userId ??
      data?.custom_data?.user_id ??
      data?.custom_data?.userID ??
      null;

    const dbSub =
      (userId
        ? await this.prisma.subscription.findUnique({ where: { userId } })
        : null) ??
      (subscriptionId
        ? await this.prisma.subscription.findFirst({
            where: { paddleSubscriptionId: subscriptionId },
          })
        : null) ??
      (transactionId
        ? await this.prisma.subscription.findFirst({
            where: { paddleTransactionId: transactionId },
          })
        : null);

    if (!dbSub) return { ok: true, ignored: true, eventType };

    // A) subscription is canonical -> always sync period + status + cancelAtPeriodEnd
    if (subscriptionId) {
      const paddleSub = await this.fetchSubscription(subscriptionId);
      const paddleStatus = this.toLower(paddleSub?.status);

      const priceId: string | null =
        paddleSub?.items?.[0]?.price?.id ??
        paddleSub?.items?.[0]?.price_id ??
        null;

      const planFromPaddle = this.priceIdToPlan(priceId);
      const { currentPeriodStart, currentPeriodEnd } =
        this.extractPeriod(paddleSub);

      const cancelAtPeriodEnd =
        this.inferCancelAtPeriodEndFromPaddle(paddleSub);

      await this.prisma.subscription.update({
        where: { userId: dbSub.userId },
        data: {
          paddleSubscriptionId: subscriptionId,
          paddleStatus,
          paddlePriceId: priceId ?? dbSub.paddlePriceId,
          ...(planFromPaddle ? { planId: planFromPaddle } : {}),
          ...(currentPeriodStart ? { currentPeriodStart } : {}),
          ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
          cancelAtPeriodEnd,
          status: 'active',
        },
      });

      return { ok: true };
    }

    // B) transaction: on paid -> activate plan + sync period via subscription fetch
    if (transactionId) {
      const txn = await this.fetchTransaction(transactionId);
      const txnStatus = this.toLower(txn?.status);
      const isPaid = this.isPaidStatus(txnStatus);

      const priceId =
        txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

      const planFromTxn = this.priceIdToPlan(priceId);

      const paddleSubscriptionIdFromTxn =
        txn?.subscription_id ?? txn?.subscription?.id ?? null;

      if (isPaid) {
        const targetPlan = dbSub.pendingPlanId ?? planFromTxn ?? dbSub.planId;

        let periodStart: Date | null = null;
        let periodEnd: Date | null = null;

        const subId = paddleSubscriptionIdFromTxn ?? dbSub.paddleSubscriptionId;

        if (subId) {
          const paddleSub = await this.fetchSubscription(subId);
          const p = this.extractPeriod(paddleSub);
          periodStart = p.currentPeriodStart;
          periodEnd = p.currentPeriodEnd;
        }

        await this.prisma.subscription.update({
          where: { userId: dbSub.userId },
          data: {
            status: 'active',
            planId: targetPlan,
            pendingPlanId: null,
            cancelAtPeriodEnd: false,
            paddleStatus: txnStatus,
            paddleTransactionId: transactionId,
            paddleSubscriptionId: subId ?? dbSub.paddleSubscriptionId,
            paddlePriceId: priceId ?? dbSub.paddlePriceId,
            ...(periodStart ? { currentPeriodStart: periodStart } : {}),
            ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
          },
        });
      } else {
        // not paid => just record status + clear pending; no downgrade here
        await this.prisma.subscription.update({
          where: { userId: dbSub.userId },
          data: {
            status: 'active',
            pendingPlanId: null,
            paddleStatus: txnStatus,
            paddleTransactionId: transactionId,
          },
        });
      }

      return { ok: true };
    }

    return { ok: true, ignored: true, eventType };
  }
}
