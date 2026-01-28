import { Body, Controller, Headers, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';

@Controller('billing/paddle')
export class PaddleWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('webhook')
  async handle(@Body() body: any, @Headers() headers: any) {
    // Paddle payload shape часто: { event_type, data }
    const eventType = body?.event_type ?? body?.eventType ?? body?.type;
    const data = body?.data ?? body;

    // беремо userId з custom_data (ми його туди записали при createCheckout)
    const userId: string | null =
      data?.custom_data?.userId ?? data?.custom_data?.user_id ?? null;

    // як fallback — можна ще пробувати знайти по transaction id, якщо userId нема
    const transactionId: string | null =
      data?.transaction_id ?? data?.id ?? null;

    if (!userId && !transactionId) {
      // не валимо webhook, інакше Paddle буде ретраїти
      return { ok: true, ignored: true, reason: 'No userId/transactionId' };
    }

    // намагаємось знайти subscription
    let sub = null as any;

    if (userId) {
      sub = await this.prisma.subscription.findUnique({ where: { userId } });
    } else if (transactionId) {
      sub = await this.prisma.subscription.findFirst({
        where: { paddleTransactionId: transactionId },
      });
    }

    if (!sub) {
      return { ok: true, ignored: true, reason: 'Subscription not found' };
    }

    // price id -> plan
    const priceId: string | null =
      data?.items?.[0]?.price?.id ??
      data?.items?.[0]?.price_id ??
      data?.price_id ??
      null;

    const planId = this.priceIdToPlan(priceId);

    const paddleStatus = String(data?.status ?? '').toLowerCase();

    // Беремо subscription id якщо є
    const paddleSubscriptionId =
      data?.subscription_id ?? data?.subscription?.id ?? null;

    // І оновлюємо
    // Логіка: якщо прийшло subscription.activated або transaction.paid/completed — робимо active
    const shouldActivate =
      eventType === 'subscription.activated' ||
      eventType === 'transaction.paid' ||
      eventType === 'transaction.completed' ||
      paddleStatus === 'paid' ||
      paddleStatus === 'completed';

    await this.prisma.subscription.update({
      where: { userId: sub.userId },
      data: {
        ...(planId ? { planId } : {}),
        status: shouldActivate ? 'active' : sub.status,
        paddleStatus: paddleStatus || sub.paddleStatus,
        paddleTransactionId: transactionId ?? sub.paddleTransactionId,
        paddleSubscriptionId: paddleSubscriptionId ?? sub.paddleSubscriptionId,
        // Поки без period end (його краще брати з subscription payload)
      },
    });

    return { ok: true };
  }

  private priceIdToPlan(priceId: string | null): PlanId | null {
    if (!priceId) return null;
    if (priceId === process.env.PADDLE_PRICE_BASIC_ID) return PlanId.BASIC;
    if (priceId === process.env.PADDLE_PRICE_PRO_ID) return PlanId.PRO;
    return null;
  }
}
