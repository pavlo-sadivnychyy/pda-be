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
  if (!v || !v.trim()) {
    // hard fail (crash early) is better than random 500 on click
    throw new Error(`Missing env: ${name}`);
  }
  return v.trim();
}

function normalizeBaseUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {
    // ✅ Fail fast if critical env is missing
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
    const successUrl = `${appUrl}/pricing`;
    const cancelUrl = `${appUrl}/pricing`;

    try {
      const { data } = await this.paddle.post('/transactions', {
        items: [{ price_id: priceId, quantity: 1 }],
        customer: { email: user.email },
        checkout: {
          success_url: successUrl,
          cancel_url: cancelUrl,
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
      const paddlePayload = e?.response?.data;
      this.logger.error(
        `Paddle create checkout failed: ${JSON.stringify(paddlePayload ?? e?.message ?? e)}`,
      );
      throw new BadRequestException(
        paddlePayload?.error?.detail ??
          paddlePayload?.message ??
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
        'Webhook rawBody is missing (check main.ts rawBody:true)',
      );
    }

    const secret = mustEnv('PADDLE_WEBHOOK_SECRET');

    const ok = this.verifyPaddleSignature(rawBody, signature, secret);
    if (!ok) {
      this.logger.warn(`Invalid Paddle-Signature. Header=${signature}`);
      throw new BadRequestException('Invalid Paddle-Signature');
    }

    let event: any;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON payload');
    }

    const eventType = event?.event_type;
    const data = event?.data;

    this.logger.log(`Paddle webhook: ${eventType}`);

    // 1) subscription.created/activated often includes transaction_id
    const paddleSubId = data?.id;
    const txIdFromSub = data?.transaction_id;

    if (paddleSubId && txIdFromSub) {
      const sub = await this.prisma.subscription.findFirst({
        where: { paddleTransactionId: String(txIdFromSub) },
      });

      if (sub) {
        const status = String(data?.status ?? 'active');
        const periodStart = data?.current_billing_period?.starts_at
          ? new Date(data.current_billing_period.starts_at)
          : null;
        const periodEnd = data?.current_billing_period?.ends_at
          ? new Date(data.current_billing_period.ends_at)
          : null;

        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: {
            paddleSubscriptionId: String(paddleSubId),
            paddleStatus: status,
            status: /active|trialing/i.test(status) ? 'active' : 'pending',
            currentPeriodStart: periodStart ?? sub.currentPeriodStart,
            currentPeriodEnd: periodEnd ?? sub.currentPeriodEnd,
          },
        });
      }

      return;
    }

    // 2) subscription.updated/canceled/past_due — find by paddleSubscriptionId
    const subId = data?.id;
    if (subId) {
      const local = await this.prisma.subscription.findFirst({
        where: { paddleSubscriptionId: String(subId) },
      });
      if (!local) return;

      const status = String(data?.status ?? '');
      const cancelAtPeriodEnd =
        data?.scheduled_change?.action === 'cancel' ? true : false;

      const periodStart = data?.current_billing_period?.starts_at
        ? new Date(data.current_billing_period.starts_at)
        : null;
      const periodEnd = data?.current_billing_period?.ends_at
        ? new Date(data.current_billing_period.ends_at)
        : null;

      await this.prisma.subscription.update({
        where: { id: local.id },
        data: {
          paddleStatus: status,
          cancelAtPeriodEnd,
          status: /active|trialing/i.test(status)
            ? 'active'
            : /past_due/i.test(status)
              ? 'past_due'
              : /canceled|cancelled/i.test(status)
                ? 'canceled'
                : local.status,
          currentPeriodStart: periodStart ?? local.currentPeriodStart,
          currentPeriodEnd: periodEnd ?? local.currentPeriodEnd,
        },
      });
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
      const paddlePayload = e?.response?.data;
      this.logger.error(
        `Paddle cancel failed: ${JSON.stringify(paddlePayload ?? e?.message ?? e)}`,
      );
      throw new BadRequestException(
        paddlePayload?.error?.detail ??
          paddlePayload?.message ??
          'Failed to cancel subscription',
      );
    }
  }

  /**
   * ✅ Real Paddle signature verification:
   * Header example: "ts=1700000000;h1=abcdef..."
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
