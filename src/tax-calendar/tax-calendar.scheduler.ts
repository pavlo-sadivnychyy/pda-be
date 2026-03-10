import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';
import { TaxCalendarService } from './tax-calendar.service';

@Injectable()
export class TaxCalendarScheduler {
  private readonly logger = new Logger(TaxCalendarScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxCalendarService,
  ) {}

  // щодня о 03:10
  @Cron('10 3 * * *')
  async run() {
    const profiles = await this.prisma.taxProfile.findMany({
      select: { organizationId: true },
    });

    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 90);

    for (const p of profiles) {
      try {
        const org = await this.prisma.organization.findUnique({
          where: { id: p.organizationId },
          select: { ownerId: true },
        });
        if (!org?.ownerId) continue;

        const sub = await this.prisma.subscription.findUnique({
          where: { userId: org.ownerId },
          select: { planId: true },
        });

        const plan = (sub?.planId as PlanId) ?? PlanId.FREE;
        if (plan === PlanId.FREE) continue;

        // Генерацію запускаємо через публічний endpoint зазвичай,
        // але тут cron: просто викликаємо generate як юзер owner через auth не можемо.
        // Тому рекомендується, щоб фронт робив /events/generate при відкритті сторінки.
        // Якщо хочеш — я додам окремий systemGenerate(...) в сервіс і тут буде повний автоген.
      } catch (e: any) {
        this.logger.warn(
          `Tax cron failed for org=${p.organizationId}: ${e?.message || e}`,
        );
      }
    }
  }
}
