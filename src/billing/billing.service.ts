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

    // ensure subscription exists
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

    // ✅ СТАВИМО pending, але PLAN НЕ ЧІПАЄМО
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

    if (isPaid) {
      // ✅ ТІЛЬКИ ПІСЛЯ ОПЛАТИ міняємо план
      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: {
          status: 'active',
          planId: planFromTxn ?? sub.planId,
          cancelAtPeriodEnd: false,
          paddleStatus,
          paddleTransactionId: transactionId,
        },
      });
    } else {
      // ✅ Якщо закрив або не оплатив — просто прибираємо pending
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
  // WEBHOOK
  // ===============================
  async handleWebhook(body: any, _headers: any) {
    const data = body?.data ?? body;
    const transactionId =
      data?.transaction_id ?? data?.id ?? data?.transaction?.id ?? null;

    if (!transactionId) return { ok: true, ignored: true };

    const txn = await this.fetchTransaction(transactionId);
    const paddleStatus = String(txn?.status ?? '').toLowerCase();

    const priceId =
      txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

    const planFromTxn = this.priceIdToPlan(priceId);

    const isPaid = paddleStatus === 'paid' || paddleStatus === 'completed';

    // знаходимо підписку по transactionId
    const sub = await this.prisma.subscription.findFirst({
      where: { paddleTransactionId: transactionId },
    });

    if (!sub) return { ok: true };

    if (isPaid) {
      await this.prisma.subscription.update({
        where: { userId: sub.userId },
        data: {
          status: 'active',
          planId: planFromTxn ?? sub.planId,
          cancelAtPeriodEnd: false,
          paddleStatus,
        },
      });
    }

    return { ok: true };
  }
}
