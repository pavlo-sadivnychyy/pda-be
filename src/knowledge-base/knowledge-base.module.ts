import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import multer from 'multer';

import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { AiModule } from '../ai/ai.module';
import { PlanModule } from '../plan/plan.module';

@Module({
  imports: [
    MulterModule.register({
      storage: multer.memoryStorage(),
    }),
    AiModule,
    PlanModule,
  ],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, PrismaService, FileStorageService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
