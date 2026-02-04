import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionDowngradeJob } from '../jobs/subscription-downgrade.job';

@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [BillingService, SubscriptionDowngradeJob],
  exports: [BillingService],
})
export class BillingModule {}
