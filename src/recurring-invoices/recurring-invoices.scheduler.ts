import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RecurringInvoicesService } from './recurring-invoices.service';

@Injectable()
export class RecurringInvoicesScheduler {
  constructor(private readonly recurring: RecurringInvoicesService) {}

  // every minute
  @Cron('*/1 * * * *')
  async tick() {
    await this.recurring.processDueProfiles(25);
  }
}
