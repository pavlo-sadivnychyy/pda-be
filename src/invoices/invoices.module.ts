import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicePdfService } from './invoice-pdf.service';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, PrismaService, InvoicePdfService],
  exports: [InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
