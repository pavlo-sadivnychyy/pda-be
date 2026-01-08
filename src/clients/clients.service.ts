import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClientDto) {
    const {
      organizationId,
      createdById,
      name,
      contactName,
      email,
      phone,
      taxNumber,
      address,
      notes,
    } = dto;

    if (!organizationId || !createdById) {
      throw new BadRequestException(
        'organizationId та createdById є обовʼязковими',
      );
    }

    if (!name) {
      throw new BadRequestException('Поле name є обовʼязковим');
    }

    const client = await this.prisma.client.create({
      data: {
        organizationId,
        createdById,
        name,
        contactName: contactName ?? null,
        email: email ?? null,
        phone: phone ?? null,
        taxNumber: taxNumber ?? null,
        address: address ?? null,
        notes: notes ?? null,
      },
    });

    return client;
  }

  async findAll(params: { organizationId: string; search?: string }) {
    const { organizationId, search } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    const where: any = {
      organizationId,
    };

    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { contactName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { taxNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return clients;
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new NotFoundException('Клієнта не знайдено');
    }

    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    const existing = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Клієнта не знайдено');
    }

    const client = await this.prisma.client.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        contactName: dto.contactName ?? undefined,
        email: dto.email ?? undefined,
        phone: dto.phone ?? undefined,
        taxNumber: dto.taxNumber ?? undefined,
        address: dto.address ?? undefined,
        notes: dto.notes ?? undefined,
      },
    });

    return client;
  }

  async remove(id: string) {
    const existing = await this.prisma.client.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!existing) {
      throw new NotFoundException('Клієнта не знайдено');
    }

    // 1) Перевіряємо акти
    const actsCount = await this.prisma.act.count({
      where: { clientId: id },
    });

    if (actsCount > 0) {
      throw new BadRequestException(
        `Не можна видалити клієнта: до нього прив’язано актів: ${actsCount}.`,
      );
    }

    // 2) Перевіряємо інвойси (щоб не впиратися в Invoice_clientId_fkey)
    const invoicesCount = await this.prisma.invoice.count({
      where: { clientId: id },
    });

    if (invoicesCount > 0) {
      throw new BadRequestException(
        `Не можна видалити клієнта: до нього прив’язано інвойсів: ${invoicesCount}.`,
      );
    }

    await this.prisma.client.delete({
      where: { id },
    });

    return { success: true };
  }
}
