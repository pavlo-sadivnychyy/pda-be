import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActsService } from './acts.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import type { Response } from 'express';

class CreateActFromInvoiceDto {
  invoiceId: string;
  number: string;
  title?: string;
  periodFrom?: string;
  periodTo?: string;
  notes?: string;
}

@UseGuards(ClerkAuthGuard)
@Controller('acts')
export class ActsController {
  constructor(private readonly actsService: ActsService) {}

  @Post('from-invoice')
  async createFromInvoice(
    @Body() dto: CreateActFromInvoiceDto,
    @Req() req: any,
  ) {
    if (!dto.invoiceId || !dto.number) {
      throw new BadRequestException('invoiceId та number є обовʼязковими');
    }

    const act = await this.actsService.createFromInvoice({
      ...dto,
      createdByAuthUserId: req.authUserId,
    });

    return { act };
  }

  @Get()
  async list(@Req() req: any, @Query('organizationId') organizationId: string) {
    const items = await this.actsService.listForOrganization(
      req.authUserId,
      organizationId,
    );
    return { items };
  }

  @Get(':id')
  async getById(@Req() req: any, @Param('id') id: string) {
    const act = await this.actsService.getById(req.authUserId, id);
    return { act };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const deleted = await this.actsService.remove(req.authUserId, id);
    return { success: true, deleted };
  }

  @Get(':id/pdf')
  async getPdf(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const { document, pdfBuffer } = await this.actsService.getPdf(
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

  @Post(':id/send')
  async sendAct(@Param('id') id: string, @Req() req: any) {
    return this.actsService.sendActByEmail(req.authUserId, id);
  }
}
