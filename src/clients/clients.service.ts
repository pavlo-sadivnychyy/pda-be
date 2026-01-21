import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PlanId } from '@prisma/client';

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

  // ✅ отримати planId юзера
  private async getUserPlanId(dbUserId: string): Promise<PlanId> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId: dbUserId },
      select: { planId: true },
    });

    // якщо раптом підписки немає — трактуємо як FREE
    return (sub?.planId as PlanId) ?? PlanId.FREE;
  }

  // ✅ ліміти клієнтів по планах
  private getClientsLimitByPlan(planId: PlanId): number {
    switch (planId) {
      case PlanId.FREE:
        return 3;
      case PlanId.BASIC:
        return 20;
      case PlanId.PRO:
        return Number.POSITIVE_INFINITY; // безліміт
      default:
        return 3;
    }
  }

  // ✅ перевірка доступу до організації
  // - якщо у тебе є UserOrganization запис — працює
  // - якщо немає (owner-only) — fallback на org.ownerId
  private async assertOrgAccess(dbUserId: string, organizationId: string) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    // 1) Спроба через membership (якщо раптом ти все ж створюєш owner membership)
    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId: dbUserId, organizationId } },
      select: { id: true },
    });

    if (membership) return;

    // 2) Fallback: owner-only (твій кейс)
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true },
    });

    if (!org) {
      throw new BadRequestException('Organization not found');
    }

    if (org.ownerId !== dbUserId) {
      throw new BadRequestException('No access to this organization');
    }
  }

  // ✅ normalize tags (trim, unique, limit)
  private normalizeTags(input?: string[] | null): string[] {
    if (!input || !Array.isArray(input)) return [];

    const cleaned = input
      .map((t) => (t ?? '').trim())
      .filter(Boolean)
      .map((t) => (t.length > 30 ? t.slice(0, 30) : t));

    return Array.from(new Set(cleaned)).slice(0, 20);
  }

  // ✅ NEW: enforce clients limit by plan
  private async assertClientsLimit(dbUserId: string, organizationId: string) {
    const planId = await this.getUserPlanId(dbUserId);
    const limit = this.getClientsLimitByPlan(planId);

    if (!Number.isFinite(limit)) return; // PRO (Infinity)

    const currentCount = await this.prisma.client.count({
      where: { organizationId },
    });

    if (currentCount >= limit) {
      // Текст можна зробити будь-який, головне щоб фронт показував upgrade
      throw new BadRequestException(
        `Ліміт клієнтів вичерпано для плану ${planId}: дозволено ${limit}. Оновіть підписку, щоб додати більше клієнтів.`,
      );
    }
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

      crmStatus,
      tags,
    } = dto as any;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    await this.assertOrgAccess(dbUserId, organizationId);

    // ✅ ліміт по підписці (FREE=3, BASIC=20, PRO=∞)
    await this.assertClientsLimit(dbUserId, organizationId);

    if (!name) {
      throw new BadRequestException('Поле name є обовʼязковим');
    }

    const client = await this.prisma.client.create({
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

    if (crmStatus && crmStatus.trim().length > 0) {
      where.crmStatus = crmStatus.trim();
    }

    if (tag && tag.trim().length > 0) {
      where.tags = { has: tag.trim() };
    }

    if (search && search.trim().length > 0) {
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

    const actsCount = await this.prisma.act.count({
      where: { clientId: id },
    });

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
