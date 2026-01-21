import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';

import { EmailModule } from '../email/email.module';
import { FileStorageService } from '../file-storage/file-storage.service';
import { ActivityModule } from '../activity/activity.module';
import { PlanModule } from '../plan/plan.module';

@Module({
  imports: [EmailModule, ActivityModule, PlanModule],
  controllers: [QuotesController],
  providers: [
    PrismaService,
    FileStorageService,
    QuotesService,
    QuotePdfService,
  ],
})
export class QuotesModule {}
