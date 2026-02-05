import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';

@Injectable()
export class SubscriptionDowngradeJob {
  private readonly logger = new Logger(SubscriptionDowngradeJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ✅ Check if subscription should be downgraded to FREE
   * Only downgrade if:
   * 1. User explicitly canceled (cancelAtPeriodEnd = true)
   * 2. Subscription is in a terminal bad state (canceled, expired, unpaid)
   *
   * DO NOT downgrade on past_due - Paddle will retry payment multiple times
   */
  private shouldDowngrade(sub: any): boolean {
    // 1. User explicitly requested cancellation
    if (sub.cancelAtPeriodEnd) {
      return true;
    }

    // 2. Subscription is in a terminal bad state
    const status = String(sub.paddleStatus ?? '')
      .toLowerCase()
      .trim();

    const terminalStatuses = [
      'canceled',
      'cancelled',
      'expired',
      'unpaid', // only unpaid after all retries failed
    ];

    return terminalStatuses.includes(status);
  }

  /**
   * ✅ Runs every 10 minutes to check for expired subscriptions
   * Downgrades to FREE if period ended AND user canceled OR subscription in bad state
   */
  @Cron('*/10 * * * *') // every 10 minutes
  async run() {
    const now = new Date();

    try {
      // Find all paid subscriptions that passed their period end
      const subs = await this.prisma.subscription.findMany({
        where: {
          currentPeriodEnd: { not: null, lte: now },
          NOT: { planId: PlanId.FREE },
          // Only check subscriptions that have either:
          // - explicit cancellation flag
          // - or have a Paddle status (to check if it's bad)
          OR: [{ cancelAtPeriodEnd: true }, { paddleStatus: { not: null } }],
        },
        select: {
          userId: true,
          planId: true,
          cancelAtPeriodEnd: true,
          paddleStatus: true,
          currentPeriodEnd: true,
        },
        take: 1000, // process max 1000 per run
      });

      if (!subs.length) {
        this.logger.debug('No subscriptions to process');
        return;
      }

      this.logger.log(`Found ${subs.length} subscriptions past period end`);

      // Filter subscriptions that should be downgraded
      const toDowngrade = subs.filter((s) => this.shouldDowngrade(s));

      if (!toDowngrade.length) {
        this.logger.log('No subscriptions to downgrade');
        return;
      }

      const userIds = toDowngrade.map((s) => s.userId);

      this.logger.log(
        `Downgrading ${userIds.length} subscriptions to FREE plan`,
      );

      // ✅ Downgrade to FREE and clean up Paddle references
      const result = await this.prisma.subscription.updateMany({
        where: {
          userId: { in: userIds },
          currentPeriodEnd: { not: null, lte: now },
          NOT: { planId: PlanId.FREE },
        },
        data: {
          planId: PlanId.FREE,
          status: 'active',
          pendingPlanId: null,
          cancelAtPeriodEnd: false,
          paddleStatus: 'expired',
          // ✅ Clear Paddle references to avoid conflicts on next subscription
          paddleSubscriptionId: null,
          paddleTransactionId: null,
          paddlePriceId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
        },
      });

      this.logger.log(
        `Successfully downgraded ${result.count} subscriptions to FREE`,
      );

      // Log each downgraded subscription for monitoring
      toDowngrade.forEach((sub) => {
        this.logger.log(
          `Downgraded user ${sub.userId}: ${sub.planId} -> FREE (reason: ${
            sub.cancelAtPeriodEnd
              ? 'user cancellation'
              : `bad status: ${sub.paddleStatus}`
          })`,
        );
      });
    } catch (error) {
      this.logger.error('Failed to run subscription downgrade job', error);
      throw error; // Re-throw to be caught by NestJS scheduler
    }
  }

  /**
   * ✅ Manual method to force downgrade a specific subscription (for testing/admin)
   */
  async forceDowngrade(userId: string): Promise<boolean> {
    try {
      const sub = await this.prisma.subscription.findUnique({
        where: { userId },
      });

      if (!sub) {
        this.logger.warn(`No subscription found for user ${userId}`);
        return false;
      }

      if (sub.planId === PlanId.FREE) {
        this.logger.warn(`User ${userId} already on FREE plan`);
        return false;
      }

      await this.prisma.subscription.update({
        where: { userId },
        data: {
          planId: PlanId.FREE,
          status: 'active',
          pendingPlanId: null,
          cancelAtPeriodEnd: false,
          paddleStatus: 'expired',
          paddleSubscriptionId: null,
          paddleTransactionId: null,
          paddlePriceId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
        },
      });

      this.logger.log(`Force downgraded user ${userId} to FREE plan`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to force downgrade user ${userId}`, error);
      return false;
    }
  }
}
