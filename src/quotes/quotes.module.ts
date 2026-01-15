import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';

import { EmailModule } from '../email/email.module';
import { FileStorageService } from '../file-storage/file-storage.service';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [EmailModule, ActivityModule],
  controllers: [QuotesController],
  providers: [
    PrismaService,
    FileStorageService, // ✅ Ось це треба, бо модулю нема
    QuotesService,
    QuotePdfService,
  ],
})
export class QuotesModule {}
