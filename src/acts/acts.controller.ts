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
import { ActPdfService } from './act-pdf.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

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
  constructor(
    private readonly actsService: ActsService,
    private readonly actPdfService: ActPdfService,
  ) {}

  // POST /acts/from-invoice
  @Post('from-invoice')
  async createFromInvoice(
    @Body() dto: CreateActFromInvoiceDto,
    @Req() req: any,
  ) {
    if (!dto.invoiceId || !dto.number) {
      throw new BadRequestException('invoiceId та number є обовʼязковими');
    }

    const createdByAuthUserId = req.authUserId;
    const act = await this.actsService.createFromInvoice({
      ...dto,
      createdByAuthUserId,
    });

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

  // DELETE /acts/:id
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

  // ✅ NEW: POST /acts/:id/send
  @Post(':id/send')
  async sendAct(@Param('id') id: string, @Req() req: any) {
    const result = await this.actsService.sendActByEmail(req.authUserId, id);
    return result;
  }
}
