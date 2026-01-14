import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    PrismaService,
    InvoicePdfService,
    FileStorageService,
  ],
  exports: [InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
