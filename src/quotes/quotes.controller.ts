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
  Req,
} from '@nestjs/common';
import type { Response } from 'express';

import { QuotesService } from './quotes.service';
import { QuoteStatus } from '@prisma/client';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

@UseGuards(ClerkAuthGuard)
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  async list(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
    @Query('status') status?: QuoteStatus,
    @Query('clientId') clientId?: string,
  ) {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const quotes = await this.quotesService.findAll(req.authUserId, {
      organizationId,
      status,
      clientId,
    });

    return { quotes };
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    const quote = await this.quotesService.findOne(req.authUserId, id);
    return { quote };
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateQuoteDto) {
    const quote = await this.quotesService.create(req.authUserId, dto);
    return { quote };
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    const quote = await this.quotesService.update(req.authUserId, id, dto);
    return { quote };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.quotesService.remove(req.authUserId, id);
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @Req() req: any) {
    const quote = await this.quotesService.sendQuoteByEmail(req.authUserId, id);
    return { quote };
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Req() req: any) {
    const quote = await this.quotesService.markStatus(
      req.authUserId,
      id,
      QuoteStatus.ACCEPTED,
    );
    return { quote };
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Req() req: any) {
    const quote = await this.quotesService.markStatus(
      req.authUserId,
      id,
      QuoteStatus.REJECTED,
    );
    return { quote };
  }

  @Post(':id/expire')
  async expire(@Param('id') id: string, @Req() req: any) {
    const quote = await this.quotesService.markStatus(
      req.authUserId,
      id,
      QuoteStatus.EXPIRED,
    );
    return { quote };
  }

  @Post(':id/convert-to-invoice')
  async convertToInvoice(@Param('id') id: string, @Req() req: any) {
    const invoice = await this.quotesService.convertToInvoice(
      req.authUserId,
      id,
    );
    return { invoice };
  }

  @Get(':id/pdf')
  async getPdf(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const { document, pdfBuffer } = await this.quotesService.getQuotePdf(
      req.authUserId,
      id,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.originalName}"`,
    );
    res.end(pdfBuffer);
  }
}
