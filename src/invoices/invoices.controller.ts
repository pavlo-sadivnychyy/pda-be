import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { MarkInvoicePaidDto } from './dto/mark-invoice-paid.dto';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service';
import * as fs from 'fs';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Get('analytics')
  async getAnalytics(
    @Query('organizationId') organizationId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const analytics = await this.invoicesService.getAnalytics({
      organizationId,
      from,
      to,
    });

    return { analytics };
  }

  // POST /invoices
  @Post()
  async create(@Body() dto: CreateInvoiceDto) {
    const invoice = await this.invoicesService.create(dto);
    return { invoice };
  }

  // GET /invoices?organizationId=...&status=PAID&clientId=...
  @Get()
  async findAll(
    @Query('organizationId') organizationId: string,
    @Query('status') status?: InvoiceStatus,
    @Query('clientId') clientId?: string,
  ) {
    const invoices = await this.invoicesService.findAll({
      organizationId,
      status,
      clientId,
    });

    return { invoices };
  }

  // GET /invoices/:id
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const invoice = await this.invoicesService.findOne(id);
    return { invoice };
  }

  // PATCH /invoices/:id
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    const invoice = await this.invoicesService.update(id, dto);
    return { invoice };
  }

  // DELETE /invoices/:id
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.invoicesService.remove(id);
    return { success: true, deleted: result };
  }

  // ===== ЖИТТЄВИЙ ЦИКЛ =====

  // POST /invoices/:id/send
  @Post(':id/send')
  async send(@Param('id') id: string) {
    const invoice = await this.invoicesService.send(id);
    return { invoice };
  }

  // POST /invoices/:id/mark-paid
  @Post(':id/mark-paid')
  async markPaid(@Param('id') id: string, @Body() dto: MarkInvoicePaidDto) {
    const invoice = await this.invoicesService.markPaid(id, dto);
    return { invoice };
  }

  // POST /invoices/:id/cancel
  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    const invoice = await this.invoicesService.cancel(id);
    return { invoice };
  }

  // ===== PDF =====

  // GET /invoices/:id/pdf
  // Якщо PDF ще немає — згенерує; потім віддасть файл.
  @Get(':id/pdf')
  async getPdf(@Param('id') id: string): Promise<StreamableFile> {
    const { document, filePath } =
      await this.invoicePdfService.getOrCreatePdfForInvoice(id);

    const file = fs.createReadStream(filePath);

    return new StreamableFile(file, {
      disposition: `inline; filename="${document.originalName}"`,
      type: 'application/pdf',
    });
  }
}
