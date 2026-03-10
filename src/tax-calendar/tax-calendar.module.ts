import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { TaxCalendarController } from './tax-calendar.controller';
import { TaxCalendarService } from './tax-calendar.service';
import { TaxCalendarScheduler } from './tax-calendar.scheduler';
import { PlanModule } from '../plan/plan.module';

@Module({
  imports: [PrismaModule, BillingModule, PlanModule],
  controllers: [TaxCalendarController],
  providers: [TaxCalendarService, TaxCalendarScheduler],
  exports: [TaxCalendarService],
})
export class TaxCalendarModule {}
