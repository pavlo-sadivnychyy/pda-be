import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';
import axios from 'axios';

type CreateCheckoutInput = {
  authUserId: string;
  planId: PlanId;
};

@Injectable()
export class BillingService {
  private logger = new Logger('Billing');

  private paddleApi = axios.create({
    baseURL: process.env.PADDLE_API_URL,
    headers: {
      Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
    },
  });

  constructor(private prisma: PrismaService) {}

  // ---------------- CREATE CHECKOUT ----------------

  async createCheckout(input: CreateCheckoutInput) {
    const user = await this.prisma.user.findUnique({
      where: { authUserId: input.authUserId },
    });
    if (!user) throw new BadRequestException('User not found');

    const priceId =
      input.planId === PlanId.BASIC
        ? process.env.PADDLE_PRICE_BASIC
        : process.env.PADDLE_PRICE_PRO;

    // ---- Create transaction in Paddle ----
    const { data } = await this.paddleApi.post('/transactions', {
      items: [{ price_id: priceId, quantity: 1 }],

      custom_data: {
        userId: user.id,
        authUserId: user.authUserId,
        planId: input.planId,
      },
    });

    const txId = data?.data?.id;
    if (!txId) throw new BadRequestException('Failed to create transaction');

    // ---- Save pending subscription locally ----
    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        planId: input.planId,
        status: 'pending',
        paddleTransactionId: txId,
      },
      update: {
        planId: input.planId,
        status: 'pending',
        paddleTransactionId: txId,
      },
    });

    return { transactionId: txId };
  }

  // ---------------- GET MY SUB ----------------

  async getMySubscription(authUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) throw new BadRequestException('User not found');
    return user.subscription;
  }

  // ---------------- WEBHOOK ----------------

  async handlePaddleWebhook(rawBody?: Buffer, signature?: string) {
    if (!rawBody) throw new BadRequestException('Missing rawBody');
    if (!signature) throw new BadRequestException('Missing signature');

    const event = JSON.parse(rawBody.toString('utf8'));
    const eventType = String(event?.event_type ?? '');
    const data = event?.data ?? {};

    this.logger.log(`Webhook: ${eventType}`);

    // We only care about successful payment events
    if (
      eventType !== 'transaction.completed' &&
      eventType !== 'transaction.paid' &&
      eventType !== 'subscription.activated'
    ) {
      return;
    }

    const txId = String(data?.id ?? '');
    const custom = data?.custom_data ?? {};

    const userId = custom.userId;
    const planId = custom.planId;

    if (!userId || !planId) {
      this.logger.warn('Webhook missing custom_data');
      return;
    }

    // ---- Activate subscription ----
    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        planId,
        status: 'active',
        paddleTransactionId: txId,
      },
      update: {
        planId,
        status: 'active',
        paddleTransactionId: txId,
      },
    });

    this.logger.log(`Subscription activated for user=${userId} plan=${planId}`);
  }
}
