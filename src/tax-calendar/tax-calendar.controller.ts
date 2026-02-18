import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { TaxCalendarService } from './tax-calendar.service';
import { UpsertTaxProfileDto } from './dto/tax-profile.dto';
import {
  CreateTaxTemplateDto,
  UpdateTaxTemplateDto,
} from './dto/tax-template.dto';
import { ListTaxEventsQueryDto, MarkTaxEventDto } from './dto/tax-events.dto';

@UseGuards(ClerkAuthGuard)
@Controller('tax-calendar')
export class TaxCalendarController {
  constructor(private readonly service: TaxCalendarService) {}

  @Get('profile')
  getProfile(@Req() req: any, @Query('organizationId') organizationId: string) {
    return this.service.getProfile(req.authUserId, organizationId);
  }

  @Post('profile')
  upsertProfile(@Req() req: any, @Body() dto: UpsertTaxProfileDto) {
    return this.service.upsertProfile(req.authUserId, dto);
  }

  @Get('templates')
  listTemplates(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
  ) {
    return this.service.listTemplates(req.authUserId, organizationId);
  }

  @Post('templates')
  createTemplate(@Req() req: any, @Body() dto: CreateTaxTemplateDto) {
    return this.service.createTemplate(req.authUserId, dto);
  }

  @Patch('templates')
  updateTemplate(@Req() req: any, @Body() dto: UpdateTaxTemplateDto) {
    return this.service.updateTemplate(req.authUserId, dto);
  }

  @Get('events')
  listEvents(@Req() req: any, @Query() q: ListTaxEventsQueryDto) {
    return this.service.listEvents(
      req.authUserId,
      q.organizationId,
      new Date(q.from),
      new Date(q.to),
    );
  }

  @Post('events/generate')
  generate(
    @Req() req: any,
    @Body() body: { organizationId: string; from: string; to: string },
  ) {
    return this.service.generateEvents(
      req.authUserId,
      body.organizationId,
      new Date(body.from),
      new Date(body.to),
    );
  }

  @Post('events/:id/done')
  markDone(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: MarkTaxEventDto,
  ) {
    return this.service.markDone(
      req.authUserId,
      dto.organizationId,
      id,
      dto.note,
    );
  }

  @Post('events/:id/skip')
  markSkip(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: MarkTaxEventDto,
  ) {
    return this.service.markSkipped(
      req.authUserId,
      dto.organizationId,
      id,
      dto.note,
    );
  }

  @Post('events/:id/attachments')
  attach(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { organizationId: string; documentId: string },
  ) {
    return this.service.attachDocument(
      req.authUserId,
      body.organizationId,
      id,
      body.documentId,
    );
  }
}
