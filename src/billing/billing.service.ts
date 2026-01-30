import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';

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
        custom_data: {
          userId: user.id,
        },
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
        paddleTransactionId: transactionId,
        paddleStatus: 'created',
      },
    });

    return { transactionId };
  }

  // ===============================
  // SYNC TRANSACTION
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
    const paddleStatus = String(txn?.status ?? '').toLowerCase();

    const priceId =
      txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

    const planFromTxn = this.priceIdToPlan(priceId);

    const isPaid = paddleStatus === 'paid' || paddleStatus === 'completed';

    const paddleSubscriptionId =
      txn?.subscription_id ?? txn?.subscription?.id ?? null;

    if (isPaid) {
      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: {
          status: 'active',
          planId: planFromTxn ?? sub.planId,
          cancelAtPeriodEnd: false,
          paddleStatus,
          paddleTransactionId: transactionId,
          paddleSubscriptionId:
            paddleSubscriptionId ?? sub.paddleSubscriptionId,
          paddlePriceId: priceId ?? sub.paddlePriceId,
        },
      });
    } else {
      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: {
          status: 'active',
          paddleStatus,
          paddleTransactionId: transactionId,
        },
      });
    }

    return { ok: true };
  }

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

    if (!sub.paddleSubscriptionId) {
      throw new BadRequestException('paddleSubscriptionId is missing');
    }

    // already scheduled
    if (sub.cancelAtPeriodEnd) {
      return {
        ok: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: sub.currentPeriodEnd,
      };
    }

    let paddleSub: any;
    try {
      const res = await this.paddle.post(
        `/subscriptions/${sub.paddleSubscriptionId}/cancel`,
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
  // WEBHOOK
  // ===============================
  async handleWebhook(body: any, _headers: any) {
    const eventType = body?.event_type ?? body?.eventType ?? body?.type ?? null;
    const data = body?.data ?? body;

    const subscriptionId: string | null =
      data?.subscription_id ?? data?.subscription?.id ?? null;

    const transactionId: string | null =
      data?.transaction_id ?? data?.id ?? data?.transaction?.id ?? null;

    const userId: string | null =
      data?.custom_data?.userId ?? data?.custom_data?.user_id ?? null;

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

    if (!dbSub) return { ok: true, ignored: true };

    // subscription events: keep period end updated + keep cancelAtPeriodEnd in sync
    if (subscriptionId) {
      const paddleSub = await this.fetchSubscription(subscriptionId);
      const paddleStatus = String(paddleSub?.status ?? '').toLowerCase();

      const priceId: string | null =
        paddleSub?.items?.[0]?.price?.id ??
        paddleSub?.items?.[0]?.price_id ??
        null;

      const planFromPaddle = this.priceIdToPlan(priceId);

      const period =
        paddleSub?.current_billing_period ??
        paddleSub?.billing_period ??
        paddleSub?.billing_cycle ??
        null;

      const currentPeriodStart = period?.starts_at
        ? new Date(period.starts_at)
        : null;

      const currentPeriodEnd = period?.ends_at
        ? new Date(period.ends_at)
        : null;

      const scheduled = paddleSub?.scheduled_change ?? null;
      const cancelAtPeriodEnd =
        Boolean(scheduled) &&
        (String(scheduled?.action ?? '').toLowerCase() === 'cancel' ||
          String(scheduled?.type ?? '').toLowerCase() === 'cancel');

      const isCanceled =
        paddleStatus === 'canceled' || eventType === 'subscription.canceled';

      await this.prisma.subscription.update({
        where: { userId: dbSub.userId },
        data: {
          paddleSubscriptionId: subscriptionId,
          paddleStatus,
          paddlePriceId: priceId ?? dbSub.paddlePriceId,
          ...(planFromPaddle ? { planId: planFromPaddle } : {}),
          ...(currentPeriodStart ? { currentPeriodStart } : {}),
          ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
          cancelAtPeriodEnd: isCanceled ? false : cancelAtPeriodEnd,
          status: 'active',
        },
      });

      return { ok: true };
    }

    // transaction events: activate on paid
    if (transactionId) {
      const txn = await this.fetchTransaction(transactionId);
      const paddleStatus = String(txn?.status ?? '').toLowerCase();

      const priceId =
        txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

      const planFromTxn = this.priceIdToPlan(priceId);

      const isPaid = paddleStatus === 'paid' || paddleStatus === 'completed';

      const paddleSubscriptionIdFromTxn =
        txn?.subscription_id ?? txn?.subscription?.id ?? null;

      if (isPaid) {
        await this.prisma.subscription.update({
          where: { userId: dbSub.userId },
          data: {
            status: 'active',
            planId: planFromTxn ?? dbSub.planId,
            cancelAtPeriodEnd: false,
            paddleStatus,
            paddleTransactionId: transactionId,
            paddleSubscriptionId:
              paddleSubscriptionIdFromTxn ?? dbSub.paddleSubscriptionId,
            paddlePriceId: priceId ?? dbSub.paddlePriceId,
          },
        });
      }

      return { ok: true };
    }

    return { ok: true, ignored: true };
  }
}
