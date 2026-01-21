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
  async list(@Req() req: any, @Query('organizationId') organizationId: string) {
    const { items } = await this.actsService.listForOrganization(
      req.authUserId,
      organizationId,
    );
    return { items };
  }

  // GET /acts/:id
  @Get(':id')
  async getById(@Req() req: any, @Param('id') id: string) {
    const { act } = await this.actsService.getById(req.authUserId, id);
    return { act };
  }

  // DELETE /acts/:id
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const deleted = await this.actsService.remove(req.authUserId, id);
    return { success: true, deleted };
  }

  // GET /acts/:id/pdf  ✅ guarded + plan-checked
  @Get(':id/pdf')
  async getPdf(@Req() req: any, @Param('id') id: string, @Res() res: any) {
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

  // POST /acts/:id/send
  @Post(':id/send')
  async sendAct(@Param('id') id: string, @Req() req: any) {
    const result = await this.actsService.sendActByEmail(req.authUserId, id);
    return result;
  }
}
