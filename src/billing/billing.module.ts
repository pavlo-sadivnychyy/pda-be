import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionDowngradeJob } from '../jobs/subscription-downgrade.job';

@Module({
  controllers: [BillingController],
  providers: [BillingService, PrismaService, SubscriptionDowngradeJob],
})
export class BillingModule {}
