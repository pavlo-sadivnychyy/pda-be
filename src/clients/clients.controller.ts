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
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

@UseGuards(ClerkAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateClientDto) {
    const client = await this.clientsService.create(req.authUserId, dto);
    return { client };
  }

  // GET /clients?organizationId=...&search=...&crmStatus=...&tag=...
  @Get()
  async findAll(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
    @Query('search') search?: string,
    @Query('crmStatus') crmStatus?: string,
    @Query('tag') tag?: string,
  ) {
    const clients = await this.clientsService.findAll(req.authUserId, {
      organizationId,
      search,
      crmStatus,
      tag,
    });

    return { clients };
  }

  // GET /clients/:id
  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const client = await this.clientsService.findOne(req.authUserId, id);
    return { client };
  }

  // PATCH /clients/:id
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    const client = await this.clientsService.update(req.authUserId, id, dto);
    return { client };
  }

  // DELETE /clients/:id
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.clientsService.remove(req.authUserId, id);
  }
}
