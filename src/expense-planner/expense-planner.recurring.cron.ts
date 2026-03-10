import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExpensePlannerService } from './expense-planner.service';

@Injectable()
export class ExpensePlannerRecurringCron {
  private readonly logger = new Logger(ExpensePlannerRecurringCron.name);

  constructor(private readonly expensePlannerService: ExpensePlannerService) {}

  // Щодня о 03:10 UTC
  @Cron('10 3 * * *')
  async bootstrapRecurringExpenses() {
    try {
      const result =
        await this.expensePlannerService.bootstrapCurrentAndNextMonthForAllUsers();

      this.logger.log(
        `Expense recurring bootstrap done: users=${result.users}, plansEnsured=${result.plansEnsured}, recurringGenerated=${result.recurringGenerated}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Expense recurring bootstrap failed: ${error?.message || error}`,
        error?.stack,
      );
    }
  }
}
