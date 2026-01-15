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
  UseGuards,
  Req,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { MarkInvoicePaidDto } from './dto/mark-invoice-paid.dto';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePdfService } from './invoice-pdf.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

@UseGuards(ClerkAuthGuard) // 🔐 ВСІ /invoices/* приватні
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  // ✅ NEW: дедлайни 1–2 дні (або будь-який діапазон)
  @Get('due-soon')
  async getDueSoon(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
    @Query('minDays') minDays?: string,
    @Query('maxDays') maxDays?: string,
    @Query('includeDraft') includeDraft?: string,
    @Query('includeOverdue') includeOverdue?: string,
    @Query('limit') limit?: string,
  ) {
    const invoices = await this.invoicesService.getDueSoonInvoices({
      authUserId: req.authUserId,
      organizationId,
      minDays: minDays != null ? Number(minDays) : undefined,
      maxDays: maxDays != null ? Number(maxDays) : undefined,
      includeDraft: includeDraft === 'true',
      includeOverdue: includeOverdue === 'true',
      limit: limit != null ? Number(limit) : undefined,
    });

    return { invoices };
  }

  // ✅ NEW: надіслати reminder (з PDF у вкладенні)
  @Post(':id/send-deadline-reminder')
  async sendDeadlineReminder(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body?: {
      force?: boolean;
      message?: string;
      variant?: 'ua' | 'international';
    },
  ) {
    const result = await this.invoicesService.sendDeadlineReminder(
      req.authUserId,
      id,
      {
        force: Boolean(body?.force),
        message: body?.message,
        variant: body?.variant,
      },
    );

    return result;
  }

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
  async create(@Body() dto: CreateInvoiceDto, @Req() req: any) {
    const invoice = await this.invoicesService.create(dto, req.authUserId);
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
  async send(
    @Param('id') id: string,
    @Query('variant') variant?: 'ua' | 'international',
  ) {
    const invoice = await this.invoicesService.sendInvoiceByEmail(
      id,
      variant ?? 'ua',
    );
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
