import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanAccessService } from './plan-access.service';

@Module({
  providers: [PlanAccessService, PrismaService],
  exports: [PlanAccessService],
})
export class BillingModule {}
