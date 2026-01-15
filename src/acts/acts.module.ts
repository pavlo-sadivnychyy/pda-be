import { Module } from '@nestjs/common';
import { ActsController } from './acts.controller';
import { ActsService } from './acts.service';
import { ActPdfService } from './act-pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule], // ✅ щоб інжектити EmailService
  controllers: [ActsController],
  providers: [ActsService, ActPdfService, PrismaService, FileStorageService],
  exports: [ActsService, ActPdfService],
})
export class ActsModule {}
