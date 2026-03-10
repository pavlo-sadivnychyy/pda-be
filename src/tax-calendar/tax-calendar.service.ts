import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTaxTemplateDto,
  UpdateTaxTemplateDto,
} from './dto/tax-template.dto';
import { UpsertTaxProfileDto } from './dto/tax-profile.dto';
import { PlanId, TaxEventKind, TaxEventStatus } from '@prisma/client';
import { PlanService } from '../plan/plan.service';

function parseRrule(rrule: string): {
  freq: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  interval: number;
} {
  const parts = rrule
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  const map = Object.fromEntries(
    parts.map((p) => p.split('=').map((s) => s.trim())),
  );
  const freq = (map['FREQ'] || 'MONTHLY').toUpperCase();
  const interval = Number(map['INTERVAL'] || 1);

  if (!['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(freq)) {
    throw new BadRequestException(`Unsupported RRULE freq: ${freq}`);
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new BadRequestException(`Invalid RRULE interval: ${map['INTERVAL']}`);
  }
  return { freq: freq, interval };
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonthExclusive(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}

function startOfQuarter(d: Date) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1, 0, 0, 0, 0);
}
function endOfQuarterExclusive(d: Date) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 1, 0, 0, 0, 0);
}

function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}
function endOfYearExclusive(d: Date) {
  return new Date(d.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function setTimeLocal(date: Date, hhmm = '18:00') {
  const [hh, mm] = hhmm.split(':').map((n) => Number(n));
  const d = new Date(date);
  d.setHours(Number.isFinite(hh) ? hh : 18, Number.isFinite(mm) ? mm : 0, 0, 0);
  return d;
}

@Injectable()
export class TaxCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanService,
  ) {}

  private async assertAccessAndFeature(
    authUserId: string,
    organizationId: string,
  ) {
    const userId = await this.plans.resolveDbUserId(authUserId);
    await this.plans.assertOrgAccess(userId, organizationId);

    const plan = await this.plans.getPlanIdForUser(userId);
    // BASIC/PRO only
    if (plan === PlanId.FREE) {
      throw new ForbiddenException('Tax calendar is available on BASIC/PRO');
    }

    return { userId, plan };
  }

  // -------------------------
  // Profile
  // -------------------------
  async getProfile(authUserId: string, organizationId: string) {
    await this.assertAccessAndFeature(authUserId, organizationId);

    return this.prisma.taxProfile.findUnique({
      where: { organizationId },
      include: {
        templates: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async upsertProfile(authUserId: string, dto: UpsertTaxProfileDto) {
    const { userId } = await this.assertAccessAndFeature(
      authUserId,
      dto.organizationId,
    );

    const profile = await this.prisma.taxProfile.upsert({
      where: { organizationId: dto.organizationId },
      update: {
        jurisdiction: dto.jurisdiction,
        entityType: dto.entityType,
        settings: dto.settings,
        timezone: dto.timezone,
      },
      create: {
        organizationId: dto.organizationId,
        createdById: userId,
        jurisdiction: dto.jurisdiction,
        entityType: dto.entityType,
        settings: dto.settings,
        timezone: dto.timezone,
      },
    });

    // якщо шаблонів нема — засіємо дефолтні (MVP)
    const templatesCount = await this.prisma.taxEventTemplate.count({
      where: { organizationId: dto.organizationId, profileId: profile.id },
    });

    if (templatesCount === 0) {
      await this.seedDefaultTemplates(
        userId,
        dto.organizationId,
        profile.id,
        dto.settings,
      );
    }

    return this.getProfile(authUserId, dto.organizationId);
  }

  private async seedDefaultTemplates(
    userId: string,
    organizationId: string,
    profileId: string,
    settings: any,
  ) {
    const hasEmployees = Boolean(settings?.ua?.hasEmployees);

    const base = [
      {
        title: 'Підготувати податкові дані за період',
        kind: TaxEventKind.TASK,
        rrule: 'FREQ=MONTHLY;INTERVAL=1',
        dueOffsetDays: 0,
        dueTimeLocal: '10:00',
        description: 'Звірити доходи/інвойси, підготувати експорт/файли.',
        rule: { period: 'MONTH' },
      },
      {
        title: 'Подати звіт (налаштовується)',
        kind: TaxEventKind.REPORT,
        rrule: 'FREQ=QUARTERLY;INTERVAL=1',
        dueOffsetDays: 20,
        dueTimeLocal: '18:00',
        description: 'Дедлайн звітності за квартал (уточниш під свій кейс).',
        rule: { period: 'QUARTER' },
      },
      {
        title: 'Сплатити податок (оцінка з оплачених інвойсів)',
        kind: TaxEventKind.PAYMENT,
        rrule: 'FREQ=QUARTERLY;INTERVAL=1',
        dueOffsetDays: 25,
        dueTimeLocal: '18:00',
        description: 'Сума підтягується з оплачених інвойсів за період (MVP).',
        rule: { period: 'QUARTER', estimateFrom: 'PAID_INVOICES' },
      },
    ];

    const payroll = hasEmployees
      ? [
          {
            title: 'Зарплатні податки/внески (налаштовується)',
            kind: TaxEventKind.PAYMENT,
            rrule: 'FREQ=MONTHLY;INTERVAL=1',
            dueOffsetDays: 10,
            dueTimeLocal: '18:00',
            description: 'Якщо є працівники — налаштуй точні правила.',
            rule: { period: 'MONTH', estimateFrom: 'MANUAL' },
          },
        ]
      : [];

    await this.prisma.taxEventTemplate.createMany({
      data: [...base, ...payroll].map((t) => ({
        organizationId,
        profileId,
        createdById: userId,
        title: t.title,
        description: t.description,
        kind: t.kind,
        rrule: t.rrule,
        dueOffsetDays: t.dueOffsetDays,
        dueTimeLocal: t.dueTimeLocal,
        rule: t.rule as any,
        isActive: true,
      })),
    });
  }

  // -------------------------
  // Templates
  // -------------------------
  async listTemplates(authUserId: string, organizationId: string) {
    await this.assertAccessAndFeature(authUserId, organizationId);

    const profile = await this.prisma.taxProfile.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    if (!profile) return [];

    return this.prisma.taxEventTemplate.findMany({
      where: { organizationId, profileId: profile.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createTemplate(authUserId: string, dto: CreateTaxTemplateDto) {
    const { userId } = await this.assertAccessAndFeature(
      authUserId,
      dto.organizationId,
    );

    const profile = await this.prisma.taxProfile.findUnique({
      where: { organizationId: dto.organizationId },
      select: { id: true },
    });
    if (!profile)
      throw new BadRequestException(
        'Tax profile not found. Create profile first.',
      );

    parseRrule(dto.rrule);

    return this.prisma.taxEventTemplate.create({
      data: {
        organizationId: dto.organizationId,
        profileId: profile.id,
        createdById: userId,
        title: dto.title,
        description: dto.description,
        kind: dto.kind,
        rrule: dto.rrule,
        dueOffsetDays: dto.dueOffsetDays,
        dueTimeLocal: dto.dueTimeLocal ?? '18:00',
        rule: dto.rule ?? undefined,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateTemplate(authUserId: string, dto: UpdateTaxTemplateDto) {
    await this.assertAccessAndFeature(authUserId, dto.organizationId);

    const existing = await this.prisma.taxEventTemplate.findFirst({
      where: { id: dto.id, organizationId: dto.organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Template not found');

    if (dto.rrule) parseRrule(dto.rrule);

    return this.prisma.taxEventTemplate.update({
      where: { id: dto.id },
      data: {
        title: dto.title,
        description: dto.description,
        kind: dto.kind,
        rrule: dto.rrule,
        dueOffsetDays: dto.dueOffsetDays,
        dueTimeLocal: dto.dueTimeLocal,
        rule: dto.rule,
        isActive: dto.isActive,
      },
    });
  }

  // -------------------------
  // Events
  // -------------------------
  async listEvents(
    authUserId: string,
    organizationId: string,
    from: Date,
    to: Date,
  ) {
    await this.assertAccessAndFeature(authUserId, organizationId);

    const now = new Date();

    // проставляємо OVERDUE для прострочених
    await this.prisma.taxEventInstance.updateMany({
      where: {
        organizationId,
        dueAt: { lt: now },
        status: { in: [TaxEventStatus.UPCOMING, TaxEventStatus.IN_PROGRESS] },
      },
      data: { status: TaxEventStatus.OVERDUE },
    });

    return this.prisma.taxEventInstance.findMany({
      where: { organizationId, dueAt: { gte: from, lt: to } },
      include: {
        template: true,
        attachments: { include: { document: true } },
      },
      orderBy: { dueAt: 'asc' },
    });
  }

  async generateEvents(
    authUserId: string,
    organizationId: string,
    from: Date,
    to: Date,
  ) {
    const { userId } = await this.assertAccessAndFeature(
      authUserId,
      organizationId,
    );

    const profile = await this.prisma.taxProfile.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    if (!profile) throw new BadRequestException('Tax profile not found');

    const templates = await this.prisma.taxEventTemplate.findMany({
      where: { organizationId, profileId: profile.id, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    let created = 0;
    for (const t of templates) {
      created += await this.generateForTemplate(
        organizationId,
        t.id,
        t.rrule,
        t.dueOffsetDays,
        t.dueTimeLocal ?? '18:00',
        t.rule as any,
        from,
        to,
      );
    }

    return { created, generatedByUserId: userId };
  }

  private async generateForTemplate(
    organizationId: string,
    templateId: string,
    rrule: string,
    dueOffsetDays: number,
    dueTimeLocal: string,
    rule: any,
    from: Date,
    to: Date,
  ): Promise<number> {
    const { freq } = parseRrule(rrule);
    const periodMode =
      rule?.period ??
      (freq === 'MONTHLY'
        ? 'MONTH'
        : freq === 'QUARTERLY'
          ? 'QUARTER'
          : 'YEAR');

    const periods: Array<{ start: Date; end: Date }> = [];

    let cursor = new Date(from);
    cursor =
      periodMode === 'MONTH'
        ? startOfMonth(cursor)
        : periodMode === 'QUARTER'
          ? startOfQuarter(cursor)
          : startOfYear(cursor);

    while (cursor < to) {
      const start =
        periodMode === 'MONTH'
          ? startOfMonth(cursor)
          : periodMode === 'QUARTER'
            ? startOfQuarter(cursor)
            : startOfYear(cursor);
      const end =
        periodMode === 'MONTH'
          ? endOfMonthExclusive(cursor)
          : periodMode === 'QUARTER'
            ? endOfQuarterExclusive(cursor)
            : endOfYearExclusive(cursor);

      periods.push({ start, end });
      cursor = end;
    }

    let created = 0;

    for (const p of periods) {
      const dueBase = addDays(p.end, dueOffsetDays);
      const dueAt = setTimeLocal(dueBase, dueTimeLocal);

      const exists = await this.prisma.taxEventInstance.findFirst({
        where: {
          organizationId,
          templateId,
          periodStart: p.start,
          periodEnd: p.end,
        },
        select: { id: true },
      });
      if (exists) continue;

      const meta: any = {};
      if (rule?.estimateFrom === 'PAID_INVOICES') {
        meta.estimatedRevenue = await this.estimateRevenue(
          organizationId,
          p.start,
          p.end,
        );
      }

      await this.prisma.taxEventInstance.create({
        data: {
          organizationId,
          templateId,
          periodStart: p.start,
          periodEnd: p.end,
          dueAt,
          status: TaxEventStatus.UPCOMING,
          meta,
        },
      });

      created++;
    }

    return created;
  }

  private async estimateRevenue(organizationId: string, from: Date, to: Date) {
    const agg = await this.prisma.invoice.aggregate({
      where: {
        organizationId,
        status: 'PAID' as any,
        paidAt: { gte: from, lt: to },
      },
      _sum: { total: true },
    });

    return agg._sum.total ? String(agg._sum.total) : '0';
  }

  async markDone(
    authUserId: string,
    organizationId: string,
    eventId: string,
    note?: string,
  ) {
    const { userId } = await this.assertAccessAndFeature(
      authUserId,
      organizationId,
    );

    const ev = await this.prisma.taxEventInstance.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true },
    });
    if (!ev) throw new NotFoundException('Event not found');

    return this.prisma.taxEventInstance.update({
      where: { id: eventId },
      data: {
        status: TaxEventStatus.DONE,
        doneAt: new Date(),
        doneById: userId,
        note: note ?? undefined,
      },
    });
  }

  async markSkipped(
    authUserId: string,
    organizationId: string,
    eventId: string,
    note?: string,
  ) {
    await this.assertAccessAndFeature(authUserId, organizationId);

    const ev = await this.prisma.taxEventInstance.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true },
    });
    if (!ev) throw new NotFoundException('Event not found');

    return this.prisma.taxEventInstance.update({
      where: { id: eventId },
      data: {
        status: TaxEventStatus.SKIPPED,
        note: note ?? undefined,
      },
    });
  }

  async attachDocument(
    authUserId: string,
    organizationId: string,
    eventId: string,
    documentId: string,
  ) {
    await this.assertAccessAndFeature(authUserId, organizationId);

    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true },
    });
    if (!doc)
      throw new BadRequestException('Document not found in this organization');

    const ev = await this.prisma.taxEventInstance.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true },
    });
    if (!ev) throw new NotFoundException('Event not found');

    return this.prisma.taxEventAttachment.create({
      data: { eventId, documentId },
      include: { document: true },
    });
  }
}
