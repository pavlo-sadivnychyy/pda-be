import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanModule } from '../plan/plan.module';

@Module({
  imports: [PrismaModule, PlanModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
