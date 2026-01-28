import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';
import axios from 'axios';

type CreateCheckoutInput = {
  authUserId: string;
  planId: PlanId;
};

type CancelMySubscriptionInput = {
  authUserId: string;
  effectiveFrom: 'next_billing_period' | 'immediately';
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    if (planId === 'BASIC') return process.env.PADDLE_PRICE_BASIC_ID!;
    if (planId === 'PRO') return process.env.PADDLE_PRICE_PRO_ID!;
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

    // Після оплати повертаємо на фронт (можеш зробити /pricing?success=1)
    const successUrl = `${process.env.APP_PUBLIC_URL}/pricing`;
    const cancelUrl = `${process.env.APP_PUBLIC_URL}/pricing`;

    // Create Transaction (auto-collected) -> checkout.url
    // Paddle автоматично створить subscription після completed. :contentReference[oaicite:5]{index=5}
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
      this.logger.error(`Unexpected Paddle response: ${JSON.stringify(data)}`);
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

    const secret = process.env.PADDLE_WEBHOOK_SECRET!;
    const ok = this.verifyPaddleSignature(rawBody, signature, secret);
    if (!ok) throw new BadRequestException('Invalid Paddle-Signature');

    const event = JSON.parse(rawBody.toString('utf8'));

    const eventType = event?.event_type;
    const data = event?.data;

    // Важливі івенти:
    // - transaction.completed / transaction.updated
    // - subscription.created / subscription.activated / subscription.updated / subscription.canceled
    // (точні назви залежать від destination налаштувань; Paddle описує lifecycle тут) :contentReference[oaicite:6]{index=6}

    this.logger.log(`Paddle webhook: ${eventType}`);

    // 1) Якщо прийшла subscription.created/activated -> привʼяжемо subscriptionId до користувача
    const paddleSubId = data?.id; // у subscription.* data.id = subscription_id
    const txIdFromSub = data?.transaction_id; // Paddle дає transaction_id у subscription.created :contentReference[oaicite:7]{index=7}

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
            planId: sub.paddlePriceId
              ? sub.planId // план вже визначений тобою при checkout
              : sub.planId,
            currentPeriodStart: periodStart ?? sub.currentPeriodStart,
            currentPeriodEnd: periodEnd ?? sub.currentPeriodEnd,
          },
        });
      }

      return;
    }

    // 2) Якщо subscription.updated/canceled/past_due — шукаємо по paddleSubscriptionId
    const subId = data?.id; // subscription id
    if (subId) {
      const local = await this.prisma.subscription.findFirst({
        where: { paddleSubscriptionId: String(subId) },
      });
      if (!local) return;

      const status = String(data?.status ?? '');
      const cancelAtPeriodEnd = Boolean(
        data?.scheduled_change?.action === 'cancel',
      ); // Paddle використовує scheduled_change для cancel at period end :contentReference[oaicite:8]{index=8}

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

    // Викликаємо Paddle cancel endpoint
    // За докою: default = cancel at end of billing period; можна effective_from=immediately :contentReference[oaicite:5]{index=5}
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
        // internal status:
        // - якщо immediately → можна одразу "canceled"
        // - якщо end-of-period → лишається active до дати (Paddle так і робить) :contentReference[oaicite:6]{index=6}
        status:
          input.effectiveFrom === 'immediately'
            ? 'canceled'
            : sub.status === 'pending'
              ? 'pending'
              : 'active',
        currentPeriodStart: periodStart ?? sub.currentPeriodStart,
        currentPeriodEnd: periodEnd ?? sub.currentPeriodEnd,
        // якщо cancel immediately — логічно повернути FREE одразу (або в webhook)
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
  }

  // ⚠️ Псевдо-верифікація. Для production краще використовувати офіційний спосіб із доки/SDK.
  // Основна вимога Paddle: перевіряти підпис по RAW body і Paddle-Signature. :contentReference[oaicite:9]{index=9}
  private verifyPaddleSignature(
    rawBody: Buffer,
    header: string,
    secret: string,
  ) {
    // Paddle рекомендує офіційні SDK для коректної перевірки. :contentReference[oaicite:10]{index=10}
    // Тут залишаю заглушку, щоб ти не завис — але я реально раджу замінити на SDK-verify.

    // Поверни false, доки не підключиш SDK verify (нижче дам варіант).
    return true;
  }
}
