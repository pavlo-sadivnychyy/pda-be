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
    const env = (process.env.PADDLE_ENV ?? 'sandbox').toLowerCase(); // "sandbox" | "production"
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

  async createCheckout(input: CreateCheckoutInput) {
    const { authUserId, planId } = input;

    if (!authUserId) throw new BadRequestException('authUserId missing');
    if (!planId) throw new BadRequestException('planId missing');
    if (planId === PlanId.FREE) {
      throw new BadRequestException('FREE does not require checkout');
    }

    this.requireEnv('PADDLE_API_KEY');

    const priceId = this.getPriceId(planId);
    if (!priceId) {
      throw new InternalServerErrorException(
        `PriceId is not configured for plan ${planId}. Set PADDLE_PRICE_BASIC_ID / PADDLE_PRICE_PRO_ID`,
      );
    }

    const frontendUrl = this.requireEnv('APP_PUBLIC_URL'); // https://dev.spravly.com

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // ensure subscription row exists
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
          planId,
        },
        checkout: {
          settings: {
            display_mode: 'wide-overlay',
            // return page AFTER payment (front will sync + redirect to pricing)
            success_url: `${frontendUrl}/checkout?transaction_id={transaction_id}&result=success`,
            cancel_url: `${frontendUrl}/pricing?checkout=cancel`,
          },
        },
      });

      transactionId = res?.data?.data?.id;
      if (!transactionId)
        throw new Error('Paddle did not return transaction id');
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.response?.data?.error?.message ??
          e?.response?.data?.message ??
          e?.message ??
          'Failed to create Paddle transaction',
      );
    }

    // mark pending locally (so UI can show "processing")
    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: {
        status: 'pending',
        planId,
        paddleTransactionId: transactionId,
      },
    });

    // IMPORTANT: no redirect url to your /checkout for “payment”
    return {
      transactionId,
      successUrl: `${frontendUrl}/checkout?transaction_id=${transactionId}&result=success`,
      cancelUrl: `${frontendUrl}/pricing?checkout=cancel`,
    };
  }

  async syncTransactionToDb(input: SyncTxnInput) {
    const { authUserId, transactionId } = input;

    if (!authUserId) throw new BadRequestException('authUserId missing');
    if (!transactionId) throw new BadRequestException('transactionId missing');

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const txn = await this.fetchTransaction(transactionId);
    const paddleStatus = String(txn?.status ?? '').toLowerCase();

    const priceId: string | null =
      txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

    const planId = this.priceIdToPlan(priceId);

    const isPaid = paddleStatus === 'paid' || paddleStatus === 'completed';

    // always store what we know
    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: {
        paddleStatus,
        paddleTransactionId: transactionId,
        ...(planId ? { planId } : {}),
        ...(isPaid ? { status: 'active', cancelAtPeriodEnd: false } : {}),
      },
    });

    const updated = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { subscription: true },
    });

    return { ok: true, user: updated };
  }

  // webhook handler (robust)
  async handleWebhook(body: any, _headers: any) {
    const eventType = body?.event_type ?? body?.eventType ?? body?.type ?? null;
    const data = body?.data ?? body;

    const transactionId: string | null =
      data?.transaction_id ?? data?.id ?? data?.transaction?.id ?? null;

    // If it’s a transaction event, it usually includes transaction id.
    // If not — we just ACK to avoid retries storm.
    if (!transactionId) {
      return { ok: true, ignored: true, reason: 'No transactionId', eventType };
    }

    // find subscription by transactionId first
    const sub = await this.prisma.subscription.findFirst({
      where: { paddleTransactionId: transactionId },
    });

    // If not found — try resolve via transaction custom_data.userId
    let userId: string | null = sub?.userId ?? null;

    if (!userId) {
      const txn = await this.fetchTransaction(transactionId);
      userId = txn?.custom_data?.userId ?? txn?.custom_data?.user_id ?? null;

      if (!userId) {
        return {
          ok: true,
          ignored: true,
          reason: 'No matching subscription / no custom_data.userId',
          eventType,
        };
      }
    }

    const txn = await this.fetchTransaction(transactionId);

    const paddleStatus = String(txn?.status ?? '').toLowerCase();
    const priceId: string | null =
      txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;
    const planId = this.priceIdToPlan(priceId);

    const shouldActivate =
      eventType === 'transaction.paid' ||
      eventType === 'transaction.completed' ||
      paddleStatus === 'paid' ||
      paddleStatus === 'completed';

    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        planId: planId ?? PlanId.FREE,
        status: shouldActivate ? 'active' : 'pending',
        paddleStatus,
        paddleTransactionId: transactionId,
        cancelAtPeriodEnd: false,
      },
      update: {
        paddleStatus,
        paddleTransactionId: transactionId,
        ...(planId ? { planId } : {}),
        ...(shouldActivate
          ? { status: 'active', cancelAtPeriodEnd: false }
          : {}),
      },
    });

    return { ok: true };
  }
}
