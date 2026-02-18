import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CreateRecurringProfileDto } from './dto/create-recurring-profile.dto';
import { UpdateRecurringProfileDto } from './dto/update-recurring-profile.dto';
import { RecurringInvoicesService } from './recurring-invoices.service';

@UseGuards(ClerkAuthGuard)
@Controller('recurring-invoices')
export class RecurringInvoicesController {
  constructor(private readonly recurring: RecurringInvoicesService) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateRecurringProfileDto) {
    const profile = await this.recurring.create(req.authUserId, dto);
    return { profile };
  }

  @Get()
  async list(@Req() req: any, @Query('organizationId') organizationId: string) {
    const profiles = await this.recurring.findAll(
      req.authUserId,
      organizationId,
    );
    return { profiles };
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const profile = await this.recurring.findOne(req.authUserId, id);
    return { profile };
  }

  // ✅ PAUSE endpoint
  @Patch(':id/pause')
  async pause(@Req() req: any, @Param('id') id: string) {
    const profile = await this.recurring.pause(req.authUserId, id);
    return { profile };
  }

  // ✅ RESUME endpoint
  @Patch(':id/resume')
  async resume(@Req() req: any, @Param('id') id: string) {
    const profile = await this.recurring.resume(req.authUserId, id);
    return { profile };
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringProfileDto,
  ) {
    const profile = await this.recurring.update(req.authUserId, id, dto);
    return { profile };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const result = await this.recurring.remove(req.authUserId, id);
    return { success: true, profile: result };
  }

  @Get(':id/runs')
  async runs(@Req() req: any, @Param('id') id: string) {
    const runs = await this.recurring.getRuns(req.authUserId, id);
    return { runs };
  }

  @Post('process-due')
  async processDueNow() {
    return this.recurring.processDueProfiles(25);
  }
}
