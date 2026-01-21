import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { MarkInvoicePaidDto } from './dto/mark-invoice-paid.dto';
import {
  InvoiceStatus,
  Prisma,
  ActivityEntityType,
  ActivityEventType,
} from '@prisma/client';
import { EmailService } from '../email/email.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { ActivityService } from '../activity/activity.service';
import { PlanService } from '../plan/plan.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly activity: ActivityService,
    private readonly plan: PlanService,
  ) {}

  private parseDate(dateStr?: string): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Невалідна дата: ${dateStr}`);
    }
    return d;
  }

  private isUniqueNumberError(e: any): boolean {
    return (
      e &&
      e.code === 'P2002' &&
      e.meta &&
      Array.isArray(e.meta.target) &&
      e.meta.target.includes('number')
    );
  }

  private async logStatusChange(params: {
    organizationId: string;
    actorUserId: string;
    invoiceId: string;
    from: any;
    to: any;
    meta?: any;
  }) {
    if (String(params.from) === String(params.to)) return;

    await this.activity.create({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      entityType: ActivityEntityType.INVOICE,
      entityId: params.invoiceId,
      eventType: ActivityEventType.STATUS_CHANGED,
      fromStatus: String(params.from),
      toStatus: String(params.to),
      meta: params.meta ?? undefined,
    });
  }

  // ------------------------------------------------
  // ✅ DUE SOON (PRO only)
  // ------------------------------------------------
  async getDueSoonInvoices(params: {
    authUserId: string;
    organizationId: string;
    minDays?: number;
    maxDays?: number;
    includeDraft?: boolean;
    includeOverdue?: boolean;
    limit?: number;
  }) {
    const {
      authUserId,
      organizationId,
      minDays = 1,
      maxDays = 2,
      includeDraft = false,
      includeOverdue = false,
      limit = 20,
    } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    const dbUserId = await this.plan.resolveDbUserId(authUserId);
    await this.plan.assertOrgAccess(dbUserId, organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseInvoiceReminders(planId); // ✅ PRO only

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const from = new Date(start);
    from.setDate(from.getDate() + Math.max(0, minDays));

    const to = new Date(start);
    to.setDate(to.getDate() + Math.max(minDays, maxDays) + 1); // exclusive end

    const statusFilter: any = {
      notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
    };

    if (!includeDraft) {
      statusFilter.notIn = Array.from(
        new Set([...(statusFilter.notIn ?? []), InvoiceStatus.DRAFT]),
      );
    }

    const dueWhere: any = { not: null, gte: from, lt: to };

    if (includeOverdue) {
      dueWhere.gte = undefined;
      dueWhere.lt = to;
    }

    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        dueDate: dueWhere,
        status: statusFilter,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        client: {
          select: { id: true, name: true, contactName: true, email: true },
        },
        reminders: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { id: true, sentAt: true },
        },
      },
    });

    return invoices;
  }

  // ------------------------------------------------
  // ✅ SEND DEADLINE REMINDER (PRO only + email gating)
  // ------------------------------------------------
  async sendDeadlineReminder(
    authUserId: string,
    invoiceId: string,
    options?: {
      force?: boolean;
      message?: string;
      variant?: 'ua' | 'international';
    },
  ) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        organization: true,
        client: true,
        items: true,
        pdfDocument: true,
        pdfInternationalDocument: true,
      },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, invoice.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseInvoiceReminders(planId); // ✅ PRO only
    this.plan.assertCanSendEmail(planId); // (redundant because PRO, but ok)

    if (!invoice.dueDate) {
      throw new BadRequestException('Invoice dueDate is empty.');
    }

    if (
      invoice.status === InvoiceStatus.PAID ||
      invoice.status === InvoiceStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Не можна надсилати нагадування для статусу ${invoice.status}`,
      );
    }

    if (!invoice.client || !invoice.client.email) {
      throw new BadRequestException(
        'Client email is empty. Fill client.email first.',
      );
    }

    const force = Boolean(options?.force);
    if (!force) {
      const last = await this.prisma.invoiceReminderLog.findFirst({
        where: { invoiceId, kind: 'DEADLINE' as any },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      });

      if (last?.sentAt) {
        const diffMs = Date.now() - new Date(last.sentAt).getTime();
        const hours = diffMs / (1000 * 60 * 60);
        if (hours < 12) {
          throw new BadRequestException(
            'Reminder was already sent recently. Try later or use force.',
          );
        }
      }
    }

    const to = invoice.client.email.trim();
    const orgName = invoice.organization?.name || 'Your company';
    const due = invoice.dueDate.toISOString().slice(0, 10);

    const variant = options?.variant ?? 'ua';
    const isUa = variant === 'ua';

    const { pdfBuffer } = isUa
      ? await this.invoicePdf.getOrCreatePdfForInvoiceUa(invoice.id)
      : await this.invoicePdf.getOrCreatePdfForInvoiceInternational(invoice.id);

    const safeNumber = String(invoice.number).replace(/[^a-zA-Z0-9\-]/g, '_');
    const pdfName = isUa
      ? `invoice-ua-${safeNumber}.pdf`
      : `invoice-int-${safeNumber}.pdf`;

    const subject = `Нагадування: інвойс ${invoice.number} має дедлайн ${due}`;
    const greeting = invoice.client.contactName || invoice.client.name || '';
    const extra = options?.message?.trim() || '';

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827;">
        <h2>Нагадування про оплату</h2>
        <p>Вітаємо${greeting ? `, ${greeting}` : ''}!</p>

        <div style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;">
          <div><b>Інвойс:</b> ${invoice.number}</div>
          <div><b>Дедлайн:</b> ${due}</div>
        </div>

        ${extra ? `<p style="margin-top:14px; white-space: pre-line;">${extra}</p>` : ''}

        <p style="margin-top:16px;">PDF інвойсу у вкладенні цього листа.</p>

        <p style="margin-top:16px;font-size:12px;color:#6b7280;">Sent from ${orgName}</p>
      </div>
    `;

    await this.email.sendMail({
      to,
      subject,
      html,
      text: `Нагадування про оплату\nІнвойс: ${invoice.number}\nДедлайн: ${due}\nPDF у вкладенні`,
      attachments: [
        {
          filename: pdfName,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    await this.prisma.invoiceReminderLog.create({
      data: {
        invoiceId: invoice.id,
        organizationId: invoice.organizationId,
        sentById: dbUserId,
        kind: 'DEADLINE' as any,
        toEmail: to,
        subject,
        message: extra || null,
      } as any,
    });

    await this.activity.create({
      organizationId: invoice.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.INVOICE,
      entityId: invoice.id,
      eventType: ActivityEventType.REMINDER_SENT,
      toEmail: to,
      meta: {
        invoiceNumber: invoice.number,
        dueDate: due,
        variant,
      },
    });

    return { success: true };
  }

  // ------------------------------------------------
  // ✅ SEND INVOICE BY EMAIL (email gating)
  // ------------------------------------------------
  async sendInvoiceByEmail(
    authUserId: string,
    id: string,
    variant: 'ua' | 'international' = 'ua',
  ) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        organization: true,
        client: true,
        items: true,
        pdfDocument: true,
        pdfInternationalDocument: true,
      },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, invoice.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanSendEmail(planId); // ✅ BASIC/PRO only

    if (
      invoice.status === InvoiceStatus.PAID ||
      invoice.status === InvoiceStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Не можна відправити інвойс зі статусом ${invoice.status}`,
      );
    }

    if (!invoice.client || !invoice.client.email) {
      throw new BadRequestException(
        'Client email is empty. Fill client.email first.',
      );
    }

    const to = invoice.client.email.trim();
    const orgName = invoice.organization?.name || 'Your company';

    const appUrl = (
      process.env.APP_PUBLIC_URL || 'http://localhost:3000'
    ).replace(/\/$/, '');
    const invoiceUrl = `${appUrl}/invoices/${invoice.id}`;

    const isUa = variant === 'ua';
    const { pdfBuffer } = isUa
      ? await this.invoicePdf.getOrCreatePdfForInvoiceUa(invoice.id)
      : await this.invoicePdf.getOrCreatePdfForInvoiceInternational(invoice.id);

    const money = (v: any) => {
      if (v == null) return '0.00';
      if (typeof v === 'number') return v.toFixed(2);
      if (typeof v === 'string') {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n.toFixed(2) : v;
      }
      // @ts-ignore
      if (v && typeof v.toNumber === 'function') return v.toNumber().toFixed(2);
      return String(v);
    };

    const totalStr = `${money(invoice.total)} ${invoice.currency || 'UAH'}`;

    const subject = isUa
      ? `Рахунок-фактура ${invoice.number} від ${orgName}`
      : `Invoice ${invoice.number} from ${orgName}`;

    const greeting = invoice.client.contactName || invoice.client.name || '';

    const title = isUa ? 'Рахунок-фактура' : 'Invoice';
    const viewLabel = isUa ? 'Переглянути інвойс' : 'View invoice';
    const pdfName = isUa
      ? `invoice-ua-${invoice.number}.pdf`
      : `invoice-int-${invoice.number}.pdf`;

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827;">
        <h2>${title}</h2>
        <p>${isUa ? 'Вітаємо' : 'Hello'} ${greeting},</p>

        <div style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;">
          <div><b>${isUa ? 'Інвойс' : 'Invoice'}:</b> ${invoice.number}</div>
          <div><b>${isUa ? 'Сума' : 'Total'}:</b> ${totalStr}</div>
        </div>

        <p style="margin-top:16px;">
          ${isUa ? 'PDF файл у вкладенні.' : 'PDF is attached.'}
        </p>

        <a href="${invoiceUrl}" style="display:inline-block;padding:10px 14px;background:#111827;color:white;border-radius:999px;text-decoration:none;">
          ${viewLabel}
        </a>

        <p style="margin-top:16px;font-size:12px;color:#6b7280;">
          Sent from ${orgName}
        </p>
      </div>
    `;

    await this.email.sendMail({
      to,
      subject,
      html,
      text: `${title} ${invoice.number}\nTotal: ${totalStr}\n${invoiceUrl}`,
      attachments: [
        {
          filename: pdfName,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    const beforeStatus = invoice.status;

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.SENT,
        sentAt: new Date(),
      },
      include: { items: true, client: true },
    });

    await this.activity.create({
      organizationId: invoice.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.INVOICE,
      entityId: invoice.id,
      eventType: ActivityEventType.SENT,
      toEmail: to,
      meta: { invoiceNumber: invoice.number, variant, subject },
    });

    await this.logStatusChange({
      organizationId: invoice.organizationId,
      actorUserId: dbUserId,
      invoiceId: invoice.id,
      from: beforeStatus,
      to: InvoiceStatus.SENT,
      meta: { via: 'sendInvoiceByEmail' },
    });

    return updated;
  }

  private async generateInvoiceNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;

    const lastInvoice = await this.prisma.invoice.findFirst({
      where: {
        organizationId,
        number: { startsWith: prefix },
      },
      orderBy: { createdAt: 'desc' },
      select: { number: true },
    });

    let nextSeq = 1;

    if (lastInvoice?.number) {
      const lastSeqStr = lastInvoice.number.replace(prefix, '');
      const parsed = parseInt(lastSeqStr, 10);
      if (!isNaN(parsed)) {
        nextSeq = parsed + 1;
      }
    }

    const padded = nextSeq.toString().padStart(4, '0');
    return `${prefix}${padded}`;
  }

  private calculateTotals(
    items: { quantity: number; unitPrice: number; taxRate?: number }[],
  ): {
    subtotal: Prisma.Decimal | number;
    taxAmount: Prisma.Decimal | number;
    total: Prisma.Decimal | number;
    lineTotals: { lineTotal: number; taxRate?: number }[];
  } {
    if (!items || items.length === 0) {
      throw new BadRequestException('Інвойс повинен мати хоча б одну позицію');
    }

    let subtotal = 0;
    let taxAmount = 0;
    const lineTotals: { lineTotal: number; taxRate?: number }[] = [];

    for (const item of items) {
      if (item.quantity <= 0) {
        throw new BadRequestException('Кількість повинна бути більшою за 0');
      }
      if (item.unitPrice < 0) {
        throw new BadRequestException('Ціна не може бути відʼємною');
      }

      const base = item.quantity * item.unitPrice;
      const rate = item.taxRate ?? 0;
      const lineTax = base * (rate / 100);
      const lineTotal = base + lineTax;

      subtotal += base;
      taxAmount += lineTax;
      lineTotals.push({ lineTotal, taxRate: item.taxRate });
    }

    const total = subtotal + taxAmount;

    return { subtotal, taxAmount, total, lineTotals };
  }

  // ------------------------------------------------
  // ✅ CREATE (limits)
  // ------------------------------------------------
  async create(dto: CreateInvoiceDto, createdByAuthUserId: string) {
    const {
      organizationId,
      items,
      clientId,
      issueDate,
      dueDate,
      currency,
      status,
      notes,
    } = dto as any;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    const createdByUserId =
      await this.plan.resolveDbUserId(createdByAuthUserId);
    await this.plan.assertOrgAccess(createdByUserId, organizationId);

    // ✅ invoices limit by plan (FREE total 3, BASIC 20/month, PRO unlimited)
    await this.plan.assertInvoicesLimit(createdByUserId, organizationId);

    if (!items || items.length === 0) {
      throw new BadRequestException(
        'Потрібно додати хоча б одну позицію інвойсу',
      );
    }

    const issueDateParsed = this.parseDate(issueDate) ?? new Date();
    const dueDateParsed = this.parseDate(dueDate);

    const { subtotal, taxAmount, total, lineTotals } =
      this.calculateTotals(items);

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const number = await this.generateInvoiceNumber(organizationId);

      try {
        const invoice = await this.prisma.invoice.create({
          data: {
            organizationId,
            createdById: createdByUserId,
            clientId: clientId ?? null,

            number,
            issueDate: issueDateParsed,
            dueDate: dueDateParsed ?? null,

            currency: currency ?? 'UAH',
            status: status ?? InvoiceStatus.DRAFT,
            notes: notes ?? null,

            subtotal,
            taxAmount,
            total,

            sentAt: null,
            paidAt: null,

            items: {
              create: items.map((item: any, index: number) => ({
                name: item.name,
                description: item.description ?? null,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                taxRate: item.taxRate ?? null,
                lineTotal: lineTotals[index].lineTotal,
              })),
            },
          },
          include: { items: true, client: true },
        });

        await this.activity.create({
          organizationId,
          actorUserId: createdByUserId,
          entityType: ActivityEntityType.INVOICE,
          entityId: invoice.id,
          eventType: ActivityEventType.CREATED,
          meta: { invoiceNumber: invoice.number },
        });

        return invoice;
      } catch (e: any) {
        if (this.isUniqueNumberError(e) && attempt < maxAttempts) continue;
        throw e;
      }
    }

    throw new InternalServerErrorException(
      `Не вдалося створити інвойс через конфлікт нумерації (P2002). Спробуйте ще раз.`,
    );
  }

  // ------------------------------------------------
  // ✅ READ LIST/ONE (auth + org access)
  // ------------------------------------------------
  async findAll(params: {
    authUserId: string;
    organizationId: string;
    status?: InvoiceStatus;
    clientId?: string;
  }) {
    const { authUserId, organizationId, status, clientId } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    const dbUserId = await this.plan.resolveDbUserId(authUserId);
    await this.plan.assertOrgAccess(dbUserId, organizationId);

    return this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: status ?? undefined,
        clientId: clientId ?? undefined,
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true, client: true },
    });
  }

  async findOne(params: { authUserId: string; id: string }) {
    const { authUserId, id } = params;

    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, client: true },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, invoice.organizationId);

    return invoice;
  }

  // ------------------------------------------------
  // ✅ UPDATE/DELETE (auth + org access)
  // ------------------------------------------------
  async update(params: {
    authUserId: string;
    id: string;
    dto: UpdateInvoiceDto;
  }) {
    const { authUserId, id, dto } = params;

    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);

    const beforeStatus = existing.status;

    const issueDateParsed = dto.issueDate
      ? this.parseDate(dto.issueDate)
      : undefined;
    const dueDateParsed =
      dto.dueDate === null
        ? null
        : dto.dueDate
          ? this.parseDate(dto.dueDate)
          : undefined;

    let subtotal = existing.subtotal;
    let taxAmount = existing.taxAmount ?? 0;
    let total = existing.total;

    let itemsCreate:
      | {
          name: string;
          description?: string | null;
          quantity: number;
          unitPrice: number;
          taxRate?: number | null;
          lineTotal: number;
        }[]
      | undefined;

    const hasItemsUpdate = dto.items && dto.items.length > 0;

    if (hasItemsUpdate) {
      const {
        subtotal: s,
        taxAmount: t,
        total: tt,
        lineTotals,
      } = this.calculateTotals(dto.items!);

      subtotal = s as any;
      taxAmount = t as any;
      total = tt as any;

      itemsCreate = dto.items!.map((item, index) => ({
        name: item.name,
        description: item.description ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? null,
        lineTotal: lineTotals[index].lineTotal,
      }));
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (hasItemsUpdate) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      }

      return tx.invoice.update({
        where: { id },
        data: {
          clientId: dto.clientId ?? undefined,
          issueDate: issueDateParsed ?? undefined,
          dueDate: dueDateParsed,
          currency: dto.currency ?? undefined,
          status: dto.status ?? undefined,
          notes: dto.notes ?? undefined,
          pdfDocumentId: dto.pdfDocumentId ?? undefined,

          subtotal,
          taxAmount,
          total,

          items:
            hasItemsUpdate && itemsCreate ? { create: itemsCreate } : undefined,
        },
        include: { items: true, client: true },
      });
    });

    const afterStatus = updated.status;
    if (String(beforeStatus) !== String(afterStatus)) {
      await this.logStatusChange({
        organizationId: updated.organizationId,
        actorUserId: dbUserId,
        invoiceId: updated.id,
        from: beforeStatus,
        to: afterStatus,
        meta: { via: 'update' },
      });
    }

    return updated;
  }

  async remove(params: { authUserId: string; id: string }) {
    const { authUserId, id } = params;

    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });
    if (!existing) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);

    await this.prisma.invoiceItem.deleteMany({ where: { invoiceId: id } });

    return this.prisma.invoice.delete({ where: { id } });
  }

  // ------------------------------------------------
  // ✅ SEND / MARK PAID / CANCEL (auth + org access)
  // ------------------------------------------------
  async send(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, invoice.organizationId);

    if (
      invoice.status === InvoiceStatus.PAID ||
      invoice.status === InvoiceStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Не можна відправити інвойс зі статусом ${invoice.status}`,
      );
    }

    const beforeStatus = invoice.status;

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.SENT, sentAt: new Date() },
      include: { items: true, client: true },
    });

    await this.logStatusChange({
      organizationId: updated.organizationId,
      actorUserId: dbUserId,
      invoiceId: updated.id,
      from: beforeStatus,
      to: InvoiceStatus.SENT,
      meta: { via: 'send' },
    });

    return updated;
  }

  async markPaid(authUserId: string, id: string, dto: MarkInvoicePaidDto) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, invoice.organizationId);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Скасований інвойс не можна оплатити');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Інвойс вже має статус PAID');
    }

    const beforeStatus = invoice.status;

    const paidAt =
      dto.paidAt != null
        ? (this.parseDate(dto.paidAt) ?? new Date())
        : new Date();

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.PAID, paidAt },
      include: { items: true, client: true },
    });

    await this.logStatusChange({
      organizationId: updated.organizationId,
      actorUserId: dbUserId,
      invoiceId: updated.id,
      from: beforeStatus,
      to: InvoiceStatus.PAID,
      meta: { via: 'markPaid' },
    });

    return updated;
  }

  async cancel(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    await this.plan.assertOrgAccess(dbUserId, invoice.organizationId);

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Оплачений інвойс не можна скасувати');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Інвойс вже скасовано');
    }

    const beforeStatus = invoice.status;

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
      include: { items: true, client: true },
    });

    await this.logStatusChange({
      organizationId: updated.organizationId,
      actorUserId: dbUserId,
      invoiceId: updated.id,
      from: beforeStatus,
      to: InvoiceStatus.CANCELLED,
      meta: { via: 'cancel' },
    });

    return updated;
  }

  // ------------------------------------------------
  // ✅ ANALYTICS (auth + org access) — BASIC/PRO per your plans
  // (FREE can be allowed or blocked; your PLANS says "expanded analytics" only PRO,
  // so here I block analytics on FREE. BASIC you listed as blocked too; so PRO only.
  // If you want BASIC analytics later — change to plan !== FREE.
  // ------------------------------------------------
  async getAnalytics(params: {
    authUserId: string;
    organizationId: string;
    from?: string;
    to?: string;
  }) {
    const { authUserId, organizationId, from, to } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    const dbUserId = await this.plan.resolveDbUserId(authUserId);
    await this.plan.assertOrgAccess(dbUserId, organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    // Your PLANS: analytics is in PRO features; BASIC says blocked
    if (planId !== 'PRO') {
      throw new BadRequestException('Analytics is available on PRO');
    }

    const now = new Date();
    const parsedFrom = from ? this.parseDate(from) : undefined;
    const parsedTo = to ? this.parseDate(to) : undefined;

    const dateFrom =
      parsedFrom ?? new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const dateTo = parsedTo ?? now;

    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        issueDate: { gte: dateFrom, lte: dateTo },
      },
      select: {
        status: true,
        total: true,
        issueDate: true,
        paidAt: true,
        currency: true,
      },
    });

    const toNumber = (v: any): number => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
      }
      // @ts-ignore
      if (v && typeof v.toNumber === 'function') return v.toNumber();
      return 0;
    };

    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalOverdue = 0;

    const monthMap = new Map<
      string,
      { issuedTotal: number; paidTotal: number }
    >();

    const getMonthKey = (d: Date) => {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      return `${y}-${m.toString().padStart(2, '0')}`;
    };

    let currency: string | null = null;

    for (const inv of invoices) {
      const amount = toNumber(inv.total);
      currency = currency || inv.currency || null;

      if (inv.status === InvoiceStatus.PAID) totalPaid += amount;
      if (
        inv.status === InvoiceStatus.SENT ||
        inv.status === InvoiceStatus.OVERDUE
      )
        totalOutstanding += amount;
      if (inv.status === InvoiceStatus.OVERDUE) totalOverdue += amount;

      const issueKey = getMonthKey(inv.issueDate);
      if (!monthMap.has(issueKey))
        monthMap.set(issueKey, { issuedTotal: 0, paidTotal: 0 });
      monthMap.get(issueKey)!.issuedTotal += amount;

      if (inv.status === InvoiceStatus.PAID && inv.paidAt) {
        const paidKey = getMonthKey(inv.paidAt);
        if (!monthMap.has(paidKey))
          monthMap.set(paidKey, { issuedTotal: 0, paidTotal: 0 });
        monthMap.get(paidKey)!.paidTotal += amount;
      }
    }

    const monthly = Array.from(monthMap.entries())
      .map(([month, v]) => ({
        month,
        issuedTotal: v.issuedTotal,
        paidTotal: v.paidTotal,
      }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));

    return {
      from: dateFrom.toISOString(),
      to: dateTo.toISOString(),
      currency: currency || 'UAH',
      totals: {
        paid: totalPaid,
        outstanding: totalOutstanding,
        overdue: totalOverdue,
      },
      monthly,
    };
  }
}
