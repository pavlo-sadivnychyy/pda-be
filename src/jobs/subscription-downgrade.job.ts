import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';

@Injectable()
export class SubscriptionDowngradeJob {
  private readonly logger = new Logger(SubscriptionDowngradeJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/10 * * * *') // кожні 10 хв
  async run() {
    const now = new Date();

    const subs = await this.prisma.subscription.findMany({
      where: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { not: null, lte: now },
        NOT: { planId: PlanId.FREE },
      },
      select: { userId: true },
      take: 500,
    });

    if (!subs.length) return;

    const res = await this.prisma.subscription.updateMany({
      where: {
        userId: { in: subs.map((s) => s.userId) },
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { not: null, lte: now },
      },
      data: {
        planId: PlanId.FREE,
        status: 'active',
        cancelAtPeriodEnd: false,
        paddleStatus: 'expired',
      },
    });

    this.logger.log(`Downgraded to FREE: ${res.count}`);
  }
}
