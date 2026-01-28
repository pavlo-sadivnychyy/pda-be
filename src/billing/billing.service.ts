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
    if (!apiKey) {
      // не кидаю error на старті щоб не валився app boot, але при запиті буде 500
      // краще поставити env на Heroku
    }

    this.paddle = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

  async createCheckout(input: CreateCheckoutInput) {
    const { authUserId, planId } = input;

    if (!authUserId) throw new BadRequestException('authUserId missing');
    if (!planId) throw new BadRequestException('planId missing');
    if (planId === PlanId.FREE) {
      throw new BadRequestException('FREE does not require checkout');
    }

    const apiKey = process.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('PADDLE_API_KEY is not set');
    }

    const priceId = this.getPriceId(planId);
    if (!priceId) {
      throw new InternalServerErrorException(
        `PriceId is not configured for plan ${planId}. Set PADDLE_PRICE_BASIC_ID / PADDLE_PRICE_PRO_ID`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // ✅ гарантовано є subscription
    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, planId: PlanId.FREE, status: 'active' },
      update: {},
    });

    const frontendUrl = process.env.FRONTEND_URL; // https://dev.spravly.com
    if (!frontendUrl) {
      throw new InternalServerErrorException('FRONTEND_URL is not set');
    }

    // ✅ створюємо transaction у Paddle
    // ⚠️ ВАЖЛИВО: ми НЕ віддаємо Paddle "checkout.url" на твій домен (це те, що колись давало domain not approved)
    // Ми просто створюємо transaction і відкриваємо його через Paddle.js (transactionId).
    let transactionId: string;

    try {
      const res = await this.paddle.post('/transactions', {
        items: [{ price_id: priceId, quantity: 1 }],
        customer: {
          email: user.email,
        },
        custom_data: {
          userId: user.id,
          planId,
        },
        checkout: {
          settings: {
            // Paddle overlay
            display_mode: 'wide-overlay',
            // після success ми все одно робимо sync з фронта, але цей url потрібен як fallback
            success_url: `${frontendUrl}/checkout?_ptxn={transaction_id}&result=success`,
            cancel_url: `${frontendUrl}/pricing?checkout=cancel`,
          },
        },
      });

      transactionId = res?.data?.data?.id;
      if (!transactionId) {
        throw new Error('Paddle did not return transaction id');
      }
    } catch (e: any) {
      // ТУТ у тебе і був Invalid URL, бо axios не мав baseURL.
      throw new InternalServerErrorException(
        e?.response?.data?.error?.message ??
          e?.response?.data?.message ??
          e?.message ??
          'Failed to create Paddle transaction',
      );
    }

    // ✅ ставимо pending у нашій БД (щоб UI показував "processing")
    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: {
        status: 'pending',
        planId, // бажаний план (реально активним стане після webhook / sync)
        paddleTransactionId: transactionId,
      },
    });

    // ✅ redirect на нашу сторінку /checkout, яка відкриє Paddle overlay і зробить редірект назад
    return {
      transactionId,
      checkoutUrl: `${frontendUrl}/checkout?_ptxn=${transactionId}`,
    };
  }

  // ✅ фронт викликає це після success, щоб примусово підсинхронити (навіть якщо webhook затупив)
  async syncTransactionToDb(input: SyncTxnInput) {
    const { authUserId, transactionId } = input;
    if (!authUserId) throw new BadRequestException('authUserId missing');
    if (!transactionId) throw new BadRequestException('transactionId missing');

    const user = await this.prisma.user.findUnique({ where: { authUserId } });
    if (!user) throw new NotFoundException('User not found');

    // беремо транзакцію з Paddle
    let txn: any;
    try {
      const res = await this.paddle.get(`/transactions/${transactionId}`);
      txn = res?.data?.data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.response?.data?.message ??
          e?.message ??
          'Failed to fetch transaction',
      );
    }

    // статуси Paddle бувають різні; нас цікавить paid/completed
    const paddleStatus = String(txn?.status ?? '').toLowerCase();

    // витягуємо price_id
    const priceId: string | null =
      txn?.items?.[0]?.price?.id ?? txn?.items?.[0]?.price_id ?? null;

    const planId = this.priceIdToPlan(priceId);
    if (!planId) {
      // не валимо, але збережемо як є
      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: { paddleStatus, paddleTransactionId: transactionId },
      });
      return {
        ok: true,
        synced: false,
        reason: 'Unknown price id',
        paddleStatus,
      };
    }

    const isPaid = paddleStatus === 'paid' || paddleStatus === 'completed';

    if (isPaid) {
      await this.prisma.subscription.update({
        where: { userId: user.id },
        data: {
          planId,
          status: 'active',
          cancelAtPeriodEnd: false,
          paddleStatus,
          paddleTransactionId: transactionId,
          // currentPeriodEnd краще брати з subscription events, але хоча б так:
          currentPeriodStart: new Date(),
        },
      });
      return { ok: true, synced: true, planId, paddleStatus };
    }

    // якщо ще не paid — лишаємо pending
    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: {
        planId,
        status: 'pending',
        paddleStatus,
        paddleTransactionId: transactionId,
      },
    });

    return { ok: true, synced: false, planId, paddleStatus };
  }

  private priceIdToPlan(priceId: string | null): PlanId | null {
    if (!priceId) return null;
    if (priceId === process.env.PADDLE_PRICE_BASIC_ID) return PlanId.BASIC;
    if (priceId === process.env.PADDLE_PRICE_PRO_ID) return PlanId.PRO;
    return null;
  }
}
