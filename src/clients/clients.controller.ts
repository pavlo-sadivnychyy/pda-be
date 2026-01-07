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
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  // POST /clients
  @Post()
  async create(@Body() dto: CreateClientDto) {
    const client = await this.clientsService.create(dto);
    return { client };
  }

  // GET /clients?organizationId=...&search=...
  @Get()
  async findAll(
    @Query('organizationId') organizationId: string,
    @Query('search') search?: string,
  ) {
    const clients = await this.clientsService.findAll({
      organizationId,
      search,
    });

    return { clients };
  }

  // GET /clients/:id
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const client = await this.clientsService.findOne(id);
    return { client };
  }

  // PATCH /clients/:id
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    const client = await this.clientsService.update(id, dto);
    return { client };
  }

  // DELETE /clients/:id
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.clientsService.remove(id);
    return result;
  }
}
