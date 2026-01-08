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
} from '@nestjs/common';
import { ActsService } from './acts.service';
import { ActPdfService } from './act-pdf.service';
import { S3Client } from '@aws-sdk/client-s3';

class CreateActFromInvoiceDto {
  invoiceId: string;
  number: string;
  title?: string;
  periodFrom?: string;
  periodTo?: string;
  notes?: string;
  createdById: string;
}

@Controller('acts')
export class ActsController {
  private readonly s3 = new S3Client({
    region: process.env.S3_REGION || 'eu-central-1',
  });
  constructor(
    private readonly actsService: ActsService,
    private readonly actPdfService: ActPdfService,
  ) {}

  // POST /acts/from-invoice
  @Post('from-invoice')
  async createFromInvoice(@Body() dto: CreateActFromInvoiceDto) {
    if (!dto.invoiceId || !dto.number || !dto.createdById) {
      throw new BadRequestException(
        'invoiceId, number та createdById є обовʼязковими',
      );
    }

    const act = await this.actsService.createFromInvoice(dto);
    return { act };
  }

  // GET /acts?organizationId=...
  @Get()
  async list(@Query('organizationId') organizationId: string) {
    const { items } =
      await this.actsService.listForOrganization(organizationId);
    return { items };
  }

  // GET /acts/:id
  @Get(':id')
  async getById(@Param('id') id: string) {
    const { act } = await this.actsService.getById(id);
    return { act };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const deleted = await this.actsService.remove(id);
    return { success: true, deleted };
  }

  // GET /acts/:id/pdf
  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: any) {
    const { document, pdfBuffer } =
      await this.actPdfService.getOrCreatePdfForAct(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${document.originalName}"`,
    );

    res.end(pdfBuffer);
  }
}
