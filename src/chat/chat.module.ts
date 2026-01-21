import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { PlanModule } from '../plan/plan.module';

@Module({
  imports: [PrismaModule, AiModule, PlanModule],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
