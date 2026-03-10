import { Module } from '@nestjs/common';
import { ExpensePlannerController } from './expense-planner.controller';
import { ExpensePlannerService } from './expense-planner.service';
import { ExpensePlannerRecurringCron } from './expense-planner.recurring.cron';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';

@Module({
  controllers: [ExpensePlannerController],
  providers: [
    ExpensePlannerService,
    ExpensePlannerRecurringCron,
    PrismaService,
    PlanService,
  ],
  exports: [ExpensePlannerService],
})
export class ExpensePlannerModule {}
