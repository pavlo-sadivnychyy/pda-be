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

import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@UseGuards(ClerkAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  // POST /services
  @Post()
  async create(@Req() req: any, @Body() dto: CreateServiceDto) {
    const service = await this.servicesService.create(req.authUserId, dto);
    return { service };
  }

  // GET /services?search=...
  @Get()
  async findAll(@Req() req: any, @Query('search') search?: string) {
    const services = await this.servicesService.findAll(req.authUserId, {
      search,
    });

    return { services };
  }

  // GET /services/:id
  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const service = await this.servicesService.findOne(req.authUserId, id);
    return { service };
  }

  // PATCH /services/:id
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    const service = await this.servicesService.update(req.authUserId, id, dto);
    return { service };
  }

  // DELETE /services/:id
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.servicesService.remove(req.authUserId, id);
  }
}
