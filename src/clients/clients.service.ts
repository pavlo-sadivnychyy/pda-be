import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PlanService } from '../plan/plan.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
  ) {}

  private normalizeTags(input?: string[] | null): string[] {
    if (!input || !Array.isArray(input)) return [];

    const cleaned = input
      .map((t) => (t ?? '').trim())
      .filter(Boolean)
      .map((t) => (t.length > 30 ? t.slice(0, 30) : t));

    return Array.from(new Set(cleaned)).slice(0, 20);
  }

  async create(authUserId: string, dto: CreateClientDto) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const {
      organizationId,
      createdById: _ignoreCreatedById,
      name,
      contactName,
      email,
      phone,
      taxNumber,
      address,
      notes,
      crmStatus,
      tags,
    } = dto as any;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    await this.plan.assertOrgAccess(dbUserId, organizationId);
    await this.plan.assertClientsLimit(dbUserId, organizationId);

    if (!name) {
      throw new BadRequestException('Поле name є обовʼязковим');
    }

    return this.prisma.client.create({
      data: {
        organizationId,
        createdById: dbUserId,
        name,
        contactName: contactName ?? null,
        email: email ?? null,
        phone: phone ?? null,
        taxNumber: taxNumber ?? null,
        address: address ?? null,
        notes: notes ?? null,

        crmStatus: crmStatus ?? undefined,
        tags: this.normalizeTags(tags),
      },
    });
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
    const dbUserId = await this.plan.resolveDbUserId(authUserId);
    const { organizationId, search, crmStatus, tag } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    await this.plan.assertOrgAccess(dbUserId, organizationId);

    const where: any = { organizationId };

    if (crmStatus?.trim()) where.crmStatus = crmStatus.trim();
    if (tag?.trim()) where.tags = { has: tag.trim() };

    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { contactName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { taxNumber: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }

    return this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');

    await this.plan.assertOrgAccess(dbUserId, client.organizationId);
    return client;
  }

  async update(authUserId: string, id: string, dto: UpdateClientDto) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.client.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Клієнта не знайдено');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);

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

        crmStatus: (dto as any).crmStatus ?? undefined,
        tags: (dto as any).tags
          ? this.normalizeTags((dto as any).tags)
          : undefined,
      },
    });
  }

  async remove(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.client.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });
    if (!existing) throw new NotFoundException('Клієнта не знайдено');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);

    const actsCount = await this.prisma.act.count({ where: { clientId: id } });
    if (actsCount > 0) {
      throw new BadRequestException(
        `Не можна видалити клієнта: до нього прив’язано актів: ${actsCount}.`,
      );
    }

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
