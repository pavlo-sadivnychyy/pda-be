import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanModule } from '../plan/plan.module';
import { ActivityModule } from '../activity/activity.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { RecurringInvoicesController } from './recurring-invoices.controller';
import { RecurringInvoicesService } from './recurring-invoices.service';
import { RecurringInvoicesScheduler } from './recurring-invoices.scheduler';

@Module({
  imports: [PlanModule, ActivityModule, InvoicesModule],
  controllers: [RecurringInvoicesController],
  providers: [
    PrismaService,
    RecurringInvoicesService,
    RecurringInvoicesScheduler,
  ],
  exports: [RecurringInvoicesService],
})
export class RecurringInvoicesModule {}
