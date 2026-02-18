import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityEntityType,
  ActivityEventType,
  RecurringIntervalUnit,
  RecurringProfileStatus,
  RecurringRunStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';
import { ActivityService } from '../activity/activity.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreateRecurringProfileDto } from './dto/create-recurring-profile.dto';
import { UpdateRecurringProfileDto } from './dto/update-recurring-profile.dto';

function addInterval(base: Date, unit: RecurringIntervalUnit, count: number) {
  const d = new Date(base);
  const c = Math.max(1, count || 1);

  if (unit === 'DAY') d.setDate(d.getDate() + c);
  if (unit === 'WEEK') d.setDate(d.getDate() + 7 * c);
  if (unit === 'MONTH') d.setMonth(d.getMonth() + c);
  if (unit === 'YEAR') d.setFullYear(d.getFullYear() + c);

  return d;
}

@Injectable()
export class RecurringInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
    private readonly invoices: InvoicesService,
    private readonly activity: ActivityService,
  ) {}

  // ✅ стабільний include: номер інвойсу + клієнт
  private readonly profileInclude = {
    client: { select: { id: true, name: true, email: true } },
    templateInvoice: {
      select: {
        id: true,
        number: true, // ✅ те що тобі треба
        currency: true,
        subtotal: true,
        taxAmount: true,
        total: true,
        status: true,
        issueDate: true,
        dueDate: true,
        // якщо захочеш ще: notes: true,
      },
    },
  } as const;

  private parseDate(dateStr?: string): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Невалідна дата: ${dateStr}`);
    }
    return d;
  }

  private async assertPro(authUserId: string, organizationId: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);
    await this.plan.assertOrgAccess(dbUserId, organizationId);
    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseRecurringInvoices(planId);
    return { dbUserId, planId };
  }

  // --------------------------
  // CRUD
  // --------------------------
  async create(authUserId: string, dto: CreateRecurringProfileDto) {
    const { organizationId } = dto;
    const { dbUserId } = await this.assertPro(authUserId, organizationId);

    const template = await this.prisma.invoice.findUnique({
      where: { id: dto.templateInvoiceId },
      select: { id: true, organizationId: true, clientId: true },
    });
    if (!template) throw new NotFoundException('Template invoice not found');
    if (template.organizationId !== organizationId) {
      throw new BadRequestException('Template invoice belongs to another org');
    }

    const startAt = this.parseDate(dto.startAt)!;
    const intervalCount = dto.intervalCount ?? 1;

    return this.prisma.recurringInvoiceProfile.create({
      data: {
        organizationId,
        createdById: dbUserId,
        clientId: dto.clientId ?? template.clientId ?? null,
        templateInvoiceId: dto.templateInvoiceId,
        intervalUnit: dto.intervalUnit as any,
        intervalCount,
        startAt,
        nextRunAt: startAt,
        dueDays: dto.dueDays ?? 7,
        autoSendEmail: Boolean(dto.autoSendEmail),
        variant: dto.variant ?? 'ua',
        status: RecurringProfileStatus.ACTIVE,
      } as any,
      include: this.profileInclude,
    });
  }

  async findAll(authUserId: string, organizationId: string) {
    await this.assertPro(authUserId, organizationId);

    return this.prisma.recurringInvoiceProfile.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }],
      include: this.profileInclude,
    });
  }

  async findOne(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const profile = await this.prisma.recurringInvoiceProfile.findUnique({
      where: { id },
      include: this.profileInclude,
    });
    if (!profile) throw new NotFoundException('Recurring profile not found');

    await this.plan.assertOrgAccess(dbUserId, profile.organizationId);
    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseRecurringInvoices(planId);

    return profile;
  }

  async update(authUserId: string, id: string, dto: UpdateRecurringProfileDto) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.recurringInvoiceProfile.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });
    if (!existing) throw new NotFoundException('Recurring profile not found');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);
    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseRecurringInvoices(planId);

    const data: any = {};

    if (dto.clientId !== undefined) data.clientId = dto.clientId;
    if (dto.templateInvoiceId !== undefined)
      data.templateInvoiceId = dto.templateInvoiceId;
    if (dto.intervalUnit !== undefined) data.intervalUnit = dto.intervalUnit;
    if (dto.intervalCount !== undefined) data.intervalCount = dto.intervalCount;
    if (dto.startAt !== undefined) data.startAt = this.parseDate(dto.startAt);
    if (dto.nextRunAt !== undefined)
      data.nextRunAt = this.parseDate(dto.nextRunAt);
    if (dto.dueDays !== undefined) data.dueDays = dto.dueDays;
    if (dto.autoSendEmail !== undefined)
      data.autoSendEmail = Boolean(dto.autoSendEmail);
    if (dto.variant !== undefined) data.variant = dto.variant;
    if (dto.status !== undefined) data.status = dto.status;

    return this.prisma.recurringInvoiceProfile.update({
      where: { id },
      data,
      include: this.profileInclude,
    });
  }

  async remove(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.recurringInvoiceProfile.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });
    if (!existing) throw new NotFoundException('Recurring profile not found');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);
    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseRecurringInvoices(planId);

    // soft-cancel
    return this.prisma.recurringInvoiceProfile.update({
      where: { id },
      data: { status: RecurringProfileStatus.CANCELLED },
      include: this.profileInclude,
    });
  }

  // --------------------------
  // Pause / Resume (те, чого не вистачало)
  // --------------------------
  async pause(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.recurringInvoiceProfile.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true },
    });
    if (!existing) throw new NotFoundException('Recurring profile not found');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);
    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseRecurringInvoices(planId);

    if (existing.status === RecurringProfileStatus.CANCELLED) {
      throw new BadRequestException('Профіль скасований — пауза недоступна');
    }

    if (existing.status === RecurringProfileStatus.PAUSED) {
      return this.prisma.recurringInvoiceProfile.findUnique({
        where: { id },
        include: this.profileInclude,
      });
    }

    return this.prisma.recurringInvoiceProfile.update({
      where: { id },
      data: { status: RecurringProfileStatus.PAUSED },
      include: this.profileInclude,
    });
  }

  async resume(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.recurringInvoiceProfile.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true },
    });
    if (!existing) throw new NotFoundException('Recurring profile not found');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);
    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseRecurringInvoices(planId);

    if (existing.status === RecurringProfileStatus.CANCELLED) {
      throw new BadRequestException(
        'Профіль скасований — відновлення недоступне',
      );
    }

    return this.prisma.recurringInvoiceProfile.update({
      where: { id },
      data: { status: RecurringProfileStatus.ACTIVE },
      include: this.profileInclude,
    });
  }

  async getRuns(authUserId: string, profileId: string) {
    const profile = await this.findOne(authUserId, profileId);
    return this.prisma.recurringInvoiceRun.findMany({
      where: { profileId: profile.id },
      orderBy: { runAt: 'desc' },
      take: 50,
    });
  }

  // --------------------------
  // Cron runner entry
  // --------------------------
  async processDueProfiles(limit = 25) {
    const now = new Date();

    const due = await this.prisma.recurringInvoiceProfile.findMany({
      where: {
        status: RecurringProfileStatus.ACTIVE,
        nextRunAt: { lte: now },
      },
      orderBy: [{ nextRunAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        client: {
          select: { id: true, email: true, name: true, contactName: true },
        },
        templateInvoice: {
          include: { items: true },
        },
      },
    });

    for (const p of due) {
      await this.processOneProfile(p.id).catch(() => {});
    }

    return { processed: due.length };
  }

  private async processOneProfile(profileId: string) {
    const now = new Date();

    const current = await this.prisma.recurringInvoiceProfile.findUnique({
      where: { id: profileId },
      include: {
        client: {
          select: { id: true, email: true, name: true, contactName: true },
        },
        templateInvoice: { include: { items: true } },
      },
    });
    if (!current) return;

    if (current.status !== RecurringProfileStatus.ACTIVE) {
      await this.prisma.recurringInvoiceRun.create({
        data: {
          profileId: current.id,
          runAt: now,
          status: RecurringRunStatus.SKIPPED,
          errorMessage: 'Profile is not ACTIVE',
        },
      });
      return;
    }

    if (!current.nextRunAt || current.nextRunAt > now) return;

    const runAt = current.nextRunAt;
    const nextRunAt = addInterval(
      runAt,
      current.intervalUnit,
      current.intervalCount,
    );

    const updated = await this.prisma.recurringInvoiceProfile.updateMany({
      where: {
        id: current.id,
        status: RecurringProfileStatus.ACTIVE,
        nextRunAt: runAt,
        version: current.version,
      },
      data: {
        nextRunAt,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) return;

    try {
      const createdById = current.createdById;

      const tpl = current.templateInvoice;
      if (!tpl || !tpl.items || tpl.items.length === 0) {
        throw new Error('Template invoice has no items');
      }

      const clientId = current.clientId ?? tpl.clientId ?? null;

      const issueDate = new Date(runAt);
      const dueDate =
        current.dueDays != null
          ? new Date(
              new Date(runAt).getTime() + current.dueDays * 24 * 60 * 60 * 1000,
            )
          : null;

      const invoice = await this.invoices.createFromTemplateAsDbUser({
        dbUserId: createdById,
        organizationId: current.organizationId,
        clientId,
        templateInvoiceId: tpl.id,
        issueDate,
        dueDate,
        currency: tpl.currency,
        notes: tpl.notes ?? null,
        recurringProfileId: current.id,
      });

      await this.activity.create({
        organizationId: invoice.organizationId,
        actorUserId: createdById,
        entityType: ActivityEntityType.INVOICE,
        entityId: invoice.id,
        eventType: ActivityEventType.CREATED,
        meta: {
          invoiceNumber: invoice.number,
          recurringProfileId: current.id,
          recurringRunAt: runAt.toISOString(),
        },
      });

      if (current.autoSendEmail) {
        await this.invoices.sendInvoiceByEmailDbUserId(
          createdById,
          invoice.id,
          (current.variant as any) ?? 'ua',
        );
      }

      await this.prisma.recurringInvoiceRun.create({
        data: {
          profileId: current.id,
          runAt,
          status: RecurringRunStatus.SUCCESS,
          invoiceId: invoice.id,
        },
      });

      await this.prisma.recurringInvoiceProfile.update({
        where: { id: current.id },
        data: {
          lastRunAt: runAt,
          lastInvoiceId: invoice.id,
          lastError: null,
        },
      });
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : 'Unknown error';

      await this.prisma.recurringInvoiceRun.create({
        data: {
          profileId: current.id,
          runAt,
          status: RecurringRunStatus.FAILED,
          errorMessage: msg.slice(0, 1000),
        },
      });

      await this.prisma.recurringInvoiceProfile.update({
        where: { id: current.id },
        data: {
          lastRunAt: runAt,
          lastError: msg.slice(0, 1000),
        },
      });
    }
  }
}
