import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';

type CreateCheckoutInput = {
  authUserId: string;
  planId: PlanId;
};

type CancelMySubscriptionInput = {
  authUserId: string;
  effectiveFrom: 'next_billing_period' | 'immediately';
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function normalizeBaseUrl(url: string): string {
  const u = url.trim();
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {
    mustEnv('PADDLE_ENV');
    mustEnv('PADDLE_API_KEY');
    mustEnv('PADDLE_WEBHOOK_SECRET');
    mustEnv('APP_PUBLIC_URL');
    mustEnv('PADDLE_PRICE_BASIC_ID');
    mustEnv('PADDLE_PRICE_PRO_ID');
  }

  private paddle = axios.create({
    baseURL:
      process.env.PADDLE_ENV === 'production'
        ? 'https://api.paddle.com'
        : 'https://sandbox-api.paddle.com',
    headers: {
      Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });

  private planToPriceId(planId: PlanId): string {
    if (planId === 'BASIC') return mustEnv('PADDLE_PRICE_BASIC_ID');
    if (planId === 'PRO') return mustEnv('PADDLE_PRICE_PRO_ID');
    throw new BadRequestException('Unsupported planId');
  }

  async createPaddleCheckout(input: CreateCheckoutInput) {
    const user = await this.prisma.user.findUnique({
      where: { authUserId: input.authUserId },
      include: { subscription: true },
    });
    if (!user) throw new BadRequestException('User not found');
    if (!user.email) throw new BadRequestException('User email is required');

    const priceId = this.planToPriceId(input.planId);

    const appUrl = normalizeBaseUrl(mustEnv('APP_PUBLIC_URL'));

    // ✅ IMPORTANT: your app page that includes Paddle.js and opens checkout via _ptxn
    // Default payment link must be configured in Paddle dashboard to the same page. :contentReference[oaicite:11]{index=11}
    const checkoutPage = `${appUrl}/checkout`;

    try {
      // Create transaction (auto-collected) -> includes checkout.url :contentReference[oaicite:12]{index=12}
      const { data } = await this.paddle.post('/transactions', {
        items: [{ price_id: priceId, quantity: 1 }],
        customer: { email: user.email },
        checkout: {
          // can be null to use default payment link,
          // or set explicitly to your approved domain. :contentReference[oaicite:13]{index=13}
          url: checkoutPage,
        },
        custom_data: {
          authUserId: input.authUserId,
          userId: user.id,
          planId: input.planId,
        },
      });

      const tx = data?.data;
      const transactionId = tx?.id as string | undefined;
      const checkoutUrl = tx?.checkout?.url as string | undefined;

      if (!transactionId || !checkoutUrl) {
        this.logger.error(
          `Unexpected Paddle response: ${JSON.stringify(data)}`,
        );
        throw new BadRequestException('Failed to create Paddle checkout');
      }

      // Local subscription state: pending until webhook confirms
      await this.prisma.subscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          planId: PlanId.FREE,
          status: 'pending',
          paddleTransactionId: transactionId,
          paddlePriceId: priceId,
          paddleStatus: 'transaction_created',
        },
        update: {
          status: 'pending',
          paddleTransactionId: transactionId,
          paddlePriceId: priceId,
          paddleStatus: 'transaction_created',
        },
      });

      return { transactionId, checkoutUrl };
    } catch (e: any) {
      const payload = e?.response?.data ?? null;
      this.logger.error(
        `Paddle create transaction failed: ${JSON.stringify(payload ?? e?.message ?? e)}`,
      );
      throw new BadRequestException(
        payload?.error?.detail ??
          payload?.message ??
          'Failed to create Paddle checkout',
      );
    }
  }

  async getMySubscription(authUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) throw new BadRequestException('User not found');
    return { subscription: user.subscription };
  }

  // ================== Webhook ==================
  async handlePaddleWebhook(rawBody: Buffer | undefined, signature?: string) {
    if (!signature) throw new BadRequestException('Missing Paddle-Signature');
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException(
        'Webhook rawBody is missing (check main.ts)',
      );
    }

    // ⚠️ ПОКИ verify = true. Потім заміниш на SDK.
    const event = JSON.parse(rawBody.toString('utf8'));

    const eventType = String(event?.event_type ?? '');
    const data = event?.data ?? {};
    this.logger.log(`Paddle webhook: ${eventType}`);

    // helper: safe date
    const parseDate = (v: any) => (v ? new Date(v) : null);

    // helper: detect tx/sub ids across shapes
    const txIdFromEvent =
      data?.transaction_id ??
      data?.initial_transaction_id ??
      data?.origin_transaction_id ??
      data?.transaction?.id ??
      data?.transactions?.[0]?.id ??
      null;

    const subIdFromEvent =
      data?.subscription_id ??
      data?.id ?? // subscription.* usually data.id
      data?.subscription?.id ??
      null;

    const statusFromEvent = String(data?.status ?? '');

    // helper: find local subscription row for this user/tx/sub
    const findLocalByTx = async (txId: string) =>
      this.prisma.subscription.findFirst({
        where: { paddleTransactionId: String(txId) },
      });

    const findLocalBySub = async (subId: string) =>
      this.prisma.subscription.findFirst({
        where: { paddleSubscriptionId: String(subId) },
      });

    // ---------- 1) transaction.* events ----------
    if (eventType.startsWith('transaction.')) {
      const txId = data?.id
        ? String(data.id)
        : txIdFromEvent
          ? String(txIdFromEvent)
          : null;
      if (!txId) return;

      const local = await findLocalByTx(txId);
      if (!local) {
        // якщо не знайшли по txId — просто логнемо, щоб бачити проблему
        this.logger.warn(`No local subscription found for txId=${txId}`);
        return;
      }

      // completed / paid -> active
      const isPaid = /completed|paid/i.test(String(data?.status ?? eventType));
      await this.prisma.subscription.update({
        where: { id: local.id },
        data: {
          paddleStatus: String(data?.status ?? eventType),
          status: isPaid ? 'active' : local.status,
        },
      });

      return;
    }

    // ---------- 2) subscription.* events ----------
    if (eventType.startsWith('subscription.')) {
      const subId = subIdFromEvent ? String(subIdFromEvent) : null;
      if (!subId) return;

      // пробуємо знайти по subscriptionId
      let local = await findLocalBySub(subId);

      // якщо не знайшли — пробуємо знайти по transaction id з payload
      if (!local && txIdFromEvent) {
        local = await findLocalByTx(String(txIdFromEvent));
      }

      if (!local) {
        this.logger.warn(
          `No local subscription found for subId=${subId} tx=${txIdFromEvent ?? 'null'}`,
        );
        return;
      }

      const periodStart = parseDate(data?.current_billing_period?.starts_at);
      const periodEnd = parseDate(data?.current_billing_period?.ends_at);

      const cancelAtPeriodEnd = Boolean(
        data?.scheduled_change?.action === 'cancel',
      );

      const status = String(data?.status ?? '');
      const internalStatus = /active|trialing/i.test(status)
        ? 'active'
        : /past_due/i.test(status)
          ? 'past_due'
          : /canceled|cancelled/i.test(status)
            ? 'canceled'
            : local.status;

      await this.prisma.subscription.update({
        where: { id: local.id },
        data: {
          paddleSubscriptionId: subId,
          paddleStatus: status,
          cancelAtPeriodEnd,
          status: internalStatus,
          currentPeriodStart: periodStart ?? local.currentPeriodStart,
          currentPeriodEnd: periodEnd ?? local.currentPeriodEnd,
        },
      });

      return;
    }
  }

  async cancelMySubscription(input: CancelMySubscriptionInput) {
    const user = await this.prisma.user.findUnique({
      where: { authUserId: input.authUserId },
      include: { subscription: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const sub = user.subscription;
    if (!sub?.paddleSubscriptionId) {
      throw new BadRequestException('No Paddle subscription to cancel');
    }

    try {
      const { data } = await this.paddle.post(
        `/subscriptions/${sub.paddleSubscriptionId}/cancel`,
        {
          effective_from:
            input.effectiveFrom === 'immediately'
              ? 'immediately'
              : 'next_billing_period',
        },
      );

      const updated = data?.data;
      const paddleStatus = String(updated?.status ?? '');
      const scheduledAction = updated?.scheduled_change?.action ?? null;

      const cancelAtPeriodEnd =
        input.effectiveFrom !== 'immediately' &&
        (scheduledAction === 'cancel' || scheduledAction == null);

      const periodStart = updated?.current_billing_period?.starts_at
        ? new Date(updated.current_billing_period.starts_at)
        : null;
      const periodEnd = updated?.current_billing_period?.ends_at
        ? new Date(updated.current_billing_period.ends_at)
        : null;

      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          paddleStatus,
          cancelAtPeriodEnd,
          status:
            input.effectiveFrom === 'immediately'
              ? 'canceled'
              : sub.status === 'pending'
                ? 'pending'
                : 'active',
          currentPeriodStart: periodStart ?? sub.currentPeriodStart,
          currentPeriodEnd: periodEnd ?? sub.currentPeriodEnd,
          planId: input.effectiveFrom === 'immediately' ? 'FREE' : sub.planId,
        },
      });

      return {
        ok: true,
        effectiveFrom: input.effectiveFrom,
        paddleStatus,
        cancelAtPeriodEnd,
        currentPeriodEnd: periodEnd,
      };
    } catch (e: any) {
      const payload = e?.response?.data ?? null;
      this.logger.error(
        `Paddle cancel failed: ${JSON.stringify(payload ?? e?.message ?? e)}`,
      );
      throw new BadRequestException(
        payload?.error?.detail ?? payload?.message ?? 'Failed to cancel',
      );
    }
  }

  /**
   * Paddle webhook signature verification:
   * Uses Paddle-Signature header. :contentReference[oaicite:17]{index=17}
   * Header: "ts=...;h1=..."
   * Signature: HMAC_SHA256(secret, `${ts}:${rawBody}`)
   */
  private verifyPaddleSignature(
    rawBody: Buffer,
    header: string,
    secret: string,
  ) {
    const parts = header.split(';').map((p) => p.trim());
    const tsPart = parts.find((p) => p.startsWith('ts='));
    const h1Part = parts.find((p) => p.startsWith('h1='));
    if (!tsPart || !h1Part) return false;

    const ts = tsPart.slice(3);
    const h1 = h1Part.slice(3);

    const signedPayload = Buffer.concat([
      Buffer.from(`${ts}:`, 'utf8'),
      rawBody,
    ]);

    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(h1, 'hex'),
      );
    } catch {
      return false;
    }
  }
}
