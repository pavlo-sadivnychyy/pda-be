import {
  BadRequestException,
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
} from '@nestjs/common';

import { QuotesService } from './quotes.service';
import { QuoteStatus } from '@prisma/client';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { QuotePdfService } from './quote-pdf.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

@UseGuards(ClerkAuthGuard) // ✅ весь контролер захищений
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly quotePdfService: QuotePdfService,
  ) {}

  @Get()
  async list(
    @Query('organizationId') organizationId: string,
    @Query('status') status?: QuoteStatus,
    @Query('clientId') clientId?: string,
  ) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const quotes = await this.quotesService.findAll({
      organizationId,
      status,
      clientId,
    });

    return { quotes };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const quote = await this.quotesService.findOne(id);
    return { quote };
  }

  @Post()
  async create(@Body() dto: CreateQuoteDto) {
    const quote = await this.quotesService.create(dto);
    return { quote };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateQuoteDto) {
    const quote = await this.quotesService.update(id, dto);
    return { quote };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.quotesService.remove(id);
    return { success: true };
  }

  @Post(':id/send')
  async send(@Param('id') id: string) {
    const quote = await this.quotesService.sendQuoteByEmail(id);
    return { quote };
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string) {
    const quote = await this.quotesService.markStatus(id, QuoteStatus.ACCEPTED);
    return { quote };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string) {
    const quote = await this.quotesService.markStatus(id, QuoteStatus.REJECTED);
    return { quote };
  }

  @Post(':id/expire')
  async expire(@Param('id') id: string) {
    const quote = await this.quotesService.markStatus(id, QuoteStatus.EXPIRED);
    return { quote };
  }

  @Post(':id/convert-to-invoice')
  async convertToInvoice(@Param('id') id: string) {
    const invoice = await this.quotesService.convertToInvoice(id);
    return { invoice };
  }

  // PDF endpoint (Next proxy буде викликати цей)
  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: any) {
    const { document, pdfBuffer } =
      await this.quotePdfService.getOrCreatePdfForQuote(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.originalName}"`,
    );

    res.end(pdfBuffer);
  }
}
