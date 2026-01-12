import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { MarkInvoicePaidDto } from './dto/mark-invoice-paid.dto';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service';

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

  @Post()
  async create(@Body() dto: CreateInvoiceDto) {
    const invoice = await this.invoicesService.create(dto);
    return { invoice };
  }

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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const invoice = await this.invoicesService.findOne(id);
    return { invoice };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    const invoice = await this.invoicesService.update(id, dto);
    return { invoice };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.invoicesService.remove(id);
    return { success: true, deleted: result };
  }

  @Post(':id/send')
  async send(@Param('id') id: string) {
    const invoice = await this.invoicesService.send(id);
    return { invoice };
  }

  @Post(':id/mark-paid')
  async markPaid(@Param('id') id: string, @Body() dto: MarkInvoicePaidDto) {
    const invoice = await this.invoicesService.markPaid(id, dto);
    return { invoice };
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    const invoice = await this.invoicesService.cancel(id);
    return { invoice };
  }

  // ===== PDF UA =====
  @Get(':id/pdf')
  async getPdfUa(@Param('id') id: string, @Res() res: any) {
    const { document, pdfBuffer } =
      await this.invoicePdfService.getOrCreatePdfForInvoiceUa(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.originalName}"`,
    );
    res.end(pdfBuffer);
  }

  // ===== PDF INTERNATIONAL =====
  @Get(':id/pdf-international')
  async getPdfInternational(@Param('id') id: string, @Res() res: any) {
    const { document, pdfBuffer } =
      await this.invoicePdfService.getOrCreatePdfForInvoiceInternational(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.originalName}"`,
    );
    res.end(pdfBuffer);
  }
}
