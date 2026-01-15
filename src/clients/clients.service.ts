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

  // ✅ clerk authUserId -> db userId (User.id)
  private async resolveDbUserId(authUserId: string): Promise<string> {
    if (!authUserId) throw new BadRequestException('Missing auth user');

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException(
        'User not found in DB. Call /users/sync first.',
      );
    }

    return user.id;
  }

  // ✅ (опціонально, але раджу) перевірка доступу до організації
  private async assertOrgAccess(dbUserId: string, organizationId: string) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId: dbUserId, organizationId } },
      select: { id: true },
    });

    // якщо у тебе тільки owner - можеш перевіряти org.ownerId === dbUserId
    if (!membership) {
      throw new BadRequestException('No access to this organization');
    }
  }

  // ✅ NEW: normalize tags (trim, unique, limit)
  private normalizeTags(input?: string[] | null): string[] {
    if (!input || !Array.isArray(input)) return [];

    const cleaned = input
      .map((t) => (t ?? '').trim())
      .filter(Boolean)
      .map((t) => (t.length > 30 ? t.slice(0, 30) : t));

    return Array.from(new Set(cleaned)).slice(0, 20);
  }

  async create(authUserId: string, dto: CreateClientDto) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const {
      organizationId,
      // createdById ігноруємо (бо може бути підміна)
      createdById: _ignoreCreatedById,
      name,
      contactName,
      email,
      phone,
      taxNumber,
      address,
      notes,

      // ✅ NEW
      crmStatus,
      tags,
    } = dto as any;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    await this.assertOrgAccess(dbUserId, organizationId);

    if (!name) {
      throw new BadRequestException('Поле name є обовʼязковим');
    }

    const client = await this.prisma.client.create({
      data: {
        organizationId,
        createdById: dbUserId, // ✅ справжній userId з DB
        name,
        contactName: contactName ?? null,
        email: email ?? null,
        phone: phone ?? null,
        taxNumber: taxNumber ?? null,
        address: address ?? null,
        notes: notes ?? null,

        // ✅ NEW
        crmStatus: crmStatus ?? undefined,
        tags: this.normalizeTags(tags),
      },
    });

    return client;
  }

  async findAll(
    authUserId: string,
    params: {
      organizationId: string;
      search?: string;
      crmStatus?: string;
      tag?: string;
    },
  ) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const { organizationId, search, crmStatus, tag } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    await this.assertOrgAccess(dbUserId, organizationId);

    const where: any = { organizationId };

    // ✅ NEW: filter by crmStatus
    if (crmStatus && crmStatus.trim().length > 0) {
      where.crmStatus = crmStatus.trim();
    }

    // ✅ NEW: filter by tag (Postgres array has)
    if (tag && tag.trim().length > 0) {
      where.tags = { has: tag.trim() };
    }

    // search
    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { contactName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { taxNumber: { contains: q, mode: 'insensitive' } },

        // ✅ бонус: якщо юзер ввів "VIP" — знайде по тегу теж
        { tags: { has: q } },
      ];
    }

    return this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(authUserId: string, id: string) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const client = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new NotFoundException('Клієнта не знайдено');
    }

    await this.assertOrgAccess(dbUserId, client.organizationId);

    return client;
  }

  async update(authUserId: string, id: string, dto: UpdateClientDto) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const existing = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Клієнта не знайдено');
    }

    await this.assertOrgAccess(dbUserId, existing.organizationId);

    return this.prisma.client.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        contactName: dto.contactName ?? undefined,
        email: dto.email ?? undefined,
        phone: dto.phone ?? undefined,
        taxNumber: dto.taxNumber ?? undefined,
        address: dto.address ?? undefined,
        notes: dto.notes ?? undefined,

        // ✅ NEW
        crmStatus: (dto as any).crmStatus ?? undefined,
        tags: (dto as any).tags
          ? this.normalizeTags((dto as any).tags)
          : undefined,
      },
    });
  }

  async remove(authUserId: string, id: string) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const existing = await this.prisma.client.findUnique({
      where: { id },
      select: { id: true, name: true, organizationId: true },
    });

    if (!existing) {
      throw new NotFoundException('Клієнта не знайдено');
    }

    await this.assertOrgAccess(dbUserId, existing.organizationId);

    // 1) Перевіряємо акти
    const actsCount = await this.prisma.act.count({
      where: { clientId: id },
    });

    if (actsCount > 0) {
      throw new BadRequestException(
        `Не можна видалити клієнта: до нього прив’язано актів: ${actsCount}.`,
      );
    }

    // 2) Перевіряємо інвойси
    const invoicesCount = await this.prisma.invoice.count({
      where: { clientId: id },
    });

    if (invoicesCount > 0) {
      throw new BadRequestException(
        `Не можна видалити клієнта: до нього прив’язано інвойсів: ${invoicesCount}.`,
      );
    }

    await this.prisma.client.delete({ where: { id } });

    return { success: true };
  }
}
