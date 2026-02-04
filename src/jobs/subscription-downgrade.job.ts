import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';

@Injectable()
export class SubscriptionDowngradeJob {
  private readonly logger = new Logger(SubscriptionDowngradeJob.name);

  constructor(private readonly prisma: PrismaService) {}

  private isBadStatus(status: string | null | undefined) {
    const s = String(status ?? '')
      .toLowerCase()
      .trim();
    return (
      s === 'past_due' ||
      s === 'past-due' ||
      s === 'paused' ||
      s === 'canceled' ||
      s === 'cancelled' ||
      s === 'unpaid' ||
      s === 'failed' ||
      s === 'expired'
    );
  }

  @Cron('*/10 * * * *') // кожні 10 хв
  async run() {
    const now = new Date();

    const subs = await this.prisma.subscription.findMany({
      where: {
        currentPeriodEnd: { not: null, lte: now },
        NOT: { planId: PlanId.FREE },
        OR: [{ cancelAtPeriodEnd: true }, { paddleStatus: { not: null } }],
      },
      select: {
        userId: true,
        cancelAtPeriodEnd: true,
        paddleStatus: true,
      },
      take: 1000,
    });

    if (!subs.length) return;

    const toDowngradeUserIds = subs
      .filter((s) => s.cancelAtPeriodEnd || this.isBadStatus(s.paddleStatus))
      .map((s) => s.userId);

    if (!toDowngradeUserIds.length) return;

    const res = await this.prisma.subscription.updateMany({
      where: {
        userId: { in: toDowngradeUserIds },
        currentPeriodEnd: { not: null, lte: now },
        NOT: { planId: PlanId.FREE },
      },
      data: {
        planId: PlanId.FREE,
        status: 'active',
        pendingPlanId: null,
        cancelAtPeriodEnd: false,
        paddleStatus: 'expired',
      },
    });

    this.logger.log(`Downgraded to FREE: ${res.count}`);
  }
}
