import { Module } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [PlanService, PrismaService],
  exports: [PlanService],
})
export class PlanModule {}
