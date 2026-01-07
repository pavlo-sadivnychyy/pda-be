import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceStatus } from '@prisma/client';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

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
    const invoice = await this.invoicesService.remove(id);
    return { success: true };
  }
}
