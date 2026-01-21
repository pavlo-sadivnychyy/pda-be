import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  Prisma,
  QuoteStatus,
  InvoiceStatus,
  ActivityEntityType,
  ActivityEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { QuotePdfService } from './quote-pdf.service';
import { ActivityService } from '../activity/activity.service';
import { PlanService } from '../plan/plan.service';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly quotePdf: QuotePdfService,
    private readonly activity: ActivityService,
    private readonly plan: PlanService,
  ) {}

  // =========================
  // ✅ HELPERS
  // =========================
  private parseDate(dateStr?: string): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    if (isNaN(d.getTime()))
      throw new BadRequestException(`Invalid date: ${dateStr}`);
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

  private calculateTotals(
    items: { quantity: number; unitPrice: number; taxRate?: number }[],
  ) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Quote must have at least one item');
    }

    let subtotal = 0;
    let taxAmount = 0;
    const lineTotals: { lineTotal: number; taxRate?: number }[] = [];

    for (const it of items) {
      if (it.quantity <= 0)
        throw new BadRequestException('Quantity must be > 0');
      if (it.unitPrice < 0)
        throw new BadRequestException('Unit price cannot be negative');

      const base = it.quantity * it.unitPrice;
      const rate = it.taxRate ?? 0;
      const lineTax = base * (rate / 100);
      const lineTotal = base + lineTax;

      subtotal += base;
      taxAmount += lineTax;
      lineTotals.push({ lineTotal, taxRate: it.taxRate });
    }

    const total = subtotal + taxAmount;

    return { subtotal, taxAmount, total, lineTotals };
  }

  private async generateQuoteNumber(organizationId: string) {
    const year = new Date().getFullYear();
    const prefix = `Q-${year}-`;

    const last = await this.prisma.quote.findFirst({
      where: { organizationId, number: { startsWith: prefix } },
      orderBy: { createdAt: 'desc' },
      select: { number: true },
    });

    let nextSeq = 1;
    if (last?.number) {
      const lastSeqStr = last.number.replace(prefix, '');
      const parsed = parseInt(lastSeqStr, 10);
      if (!isNaN(parsed)) nextSeq = parsed + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  private async logStatusChange(params: {
    organizationId: string;
    actorUserId: string;
    entityType: ActivityEntityType;
    entityId: string;
    from: any;
    to: any;
    meta?: any;
  }) {
    if (String(params.from) === String(params.to)) return;

    await this.activity.create({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      entityType: params.entityType,
      entityId: params.entityId,
      eventType: ActivityEventType.STATUS_CHANGED,
      fromStatus: String(params.from),
      toStatus: String(params.to),
      meta: params.meta ?? undefined,
    });
  }

  // -------------------------
  // ✅ SINGLE PLACE: access + plan gate
  // -------------------------
  private async assertQuotesAccess(authUserId: string, organizationId: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);
    await this.plan.assertOrgAccess(dbUserId, organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId); // ✅ FREE -> throws

    return { dbUserId, planId };
  }

  // =========================
  // ✅ CRUD (GET теж блокуємо)
  // =========================

  async create(authUserId: string, dto: CreateQuoteDto) {
    const {
      organizationId,
      createdById: _ignoreCreatedById,
      clientId,
      issueDate,
      validUntil,
      currency,
      status,
      notes,
      items,
    } = dto as any;

    if (!organizationId)
      throw new BadRequestException('organizationId is required');
    if (!items || items.length === 0)
      throw new BadRequestException('items are required');

    const { dbUserId } = await this.assertQuotesAccess(
      authUserId,
      organizationId,
    );

    const issueDateParsed = this.parseDate(issueDate) ?? new Date();
    const validUntilParsed = this.parseDate(validUntil);

    const calc = this.calculateTotals(items);

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const number = await this.generateQuoteNumber(organizationId);

      try {
        const quote = await this.prisma.quote.create({
          data: {
            organizationId,
            createdById: dbUserId,
            clientId: clientId ?? null,
            number,
            issueDate: issueDateParsed,
            validUntil: validUntilParsed ?? null,
            currency: currency ?? 'USD',
            status: status ?? QuoteStatus.DRAFT,
            notes: notes ?? null,

            subtotal: calc.subtotal,
            taxAmount: calc.taxAmount,
            total: calc.total,

            sentAt: null,
            lastEmailedTo: null,
            emailMessageId: null,

            items: {
              create: items.map((it, idx) => ({
                name: it.name,
                description: it.description ?? null,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                taxRate: it.taxRate ?? null,
                lineTotal: calc.lineTotals[idx].lineTotal,
              })),
            },
          },
          include: { items: true, client: true, organization: true },
        });

        await this.activity.create({
          organizationId: quote.organizationId,
          actorUserId: dbUserId,
          entityType: ActivityEntityType.QUOTE,
          entityId: quote.id,
          eventType: ActivityEventType.CREATED,
          meta: { quoteNumber: quote.number },
        });

        return quote;
      } catch (e: any) {
        if (this.isUniqueNumberError(e) && attempt < maxAttempts) continue;
        throw e;
      }
    }

    throw new InternalServerErrorException(
      'Не вдалося створити quote через конфлікт нумерації (P2002). Спробуйте ще раз.',
    );
  }

  async findAll(
    authUserId: string,
    params: { organizationId: string; status?: QuoteStatus; clientId?: string },
  ) {
    const { organizationId, status, clientId } = params;

    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    // ✅ тепер FREE теж отримає помилку
    await this.assertQuotesAccess(authUserId, organizationId);

    return this.prisma.quote.findMany({
      where: {
        organizationId,
        status: status ?? undefined,
        clientId: clientId ?? undefined,
      },
      orderBy: { createdAt: 'desc' },
      include: { client: true, items: true },
    });
  }

  async findOne(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        organization: true,
        client: true,
        items: true,
        pdfDocument: true,
      },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    await this.plan.assertOrgAccess(dbUserId, quote.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId); // ✅ FREE -> throws

    return quote;
  }

  async update(authUserId: string, id: string, dto: UpdateQuoteDto) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.quote.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Quote not found');

    await this.plan.assertOrgAccess(dbUserId, existing.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId);

    const issueDateParsed = dto.issueDate
      ? this.parseDate(dto.issueDate)
      : undefined;

    const validUntilParsed =
      dto.validUntil === null
        ? null
        : dto.validUntil
          ? this.parseDate(dto.validUntil)
          : undefined;

    let subtotal = existing.subtotal;
    let taxAmount = existing.taxAmount ?? new Prisma.Decimal(0);
    let total = existing.total;

    const hasItemsUpdate = Array.isArray(dto.items) && dto.items.length > 0;

    let itemsCreate:
      | {
          name: string;
          description?: string | null;
          quantity: number;
          unitPrice: any;
          taxRate?: any;
          lineTotal: number;
        }[]
      | undefined;

    if (hasItemsUpdate) {
      const calc = this.calculateTotals(dto.items!);
      subtotal = calc.subtotal as any;
      taxAmount = calc.taxAmount as any;
      total = calc.total as any;

      itemsCreate = dto.items!.map((it, idx) => ({
        name: it.name,
        description: it.description ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRate: it.taxRate ?? null,
        lineTotal: calc.lineTotals[idx].lineTotal,
      }));
    }

    return this.prisma.$transaction(async (tx) => {
      if (hasItemsUpdate) {
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
      }

      return tx.quote.update({
        where: { id },
        data: {
          clientId: dto.clientId ?? undefined,
          issueDate: issueDateParsed ?? undefined,
          validUntil: validUntilParsed,
          currency: dto.currency ?? undefined,
          status: dto.status ?? undefined,
          notes: dto.notes ?? undefined,

          subtotal,
          taxAmount,
          total,

          items:
            hasItemsUpdate && itemsCreate ? { create: itemsCreate } : undefined,
        },
        include: { client: true, items: true, organization: true },
      });
    });
  }

  async remove(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const quote = await this.prisma.quote.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    await this.plan.assertOrgAccess(dbUserId, quote.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId);

    await this.prisma.quoteItem.deleteMany({ where: { quoteId: id } });
    await this.prisma.quote.delete({ where: { id } });

    return { success: true };
  }

  // =========================
  // ✅ STATUS
  // =========================
  async markStatus(authUserId: string, id: string, status: QuoteStatus) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const quote = await this.prisma.quote.findUnique({ where: { id } });
    if (!quote) throw new NotFoundException('Quote not found');

    await this.plan.assertOrgAccess(dbUserId, quote.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId);

    const before = quote.status;

    const updated = await this.prisma.quote.update({
      where: { id },
      data: {
        status,
        ...(status === QuoteStatus.SENT ? { sentAt: new Date() } : {}),
      },
      include: { client: true, items: true },
    });

    await this.logStatusChange({
      organizationId: updated.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.QUOTE,
      entityId: updated.id,
      from: before,
      to: status,
      meta: { quoteNumber: updated.number, via: 'markStatus' },
    });

    return updated;
  }

  // =========================
  // ✅ SEND EMAIL (BASIC/PRO)
  // =========================
  async sendQuoteByEmail(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        organization: true,
        client: true,
        items: true,
        pdfDocument: true,
      },
    });

    if (!quote) throw new NotFoundException('Quote not found');

    await this.plan.assertOrgAccess(dbUserId, quote.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId);
    this.plan.assertCanSendEmail(planId);

    if (!quote.client || !quote.client.email) {
      throw new BadRequestException(
        'Client email is empty. Fill client.email first.',
      );
    }

    const to = quote.client.email.trim();
    const orgName = quote.organization?.name || 'Your company';
    const subject = `Commercial Offer ${quote.number} from ${orgName}`;

    const appUrl = (
      process.env.APP_PUBLIC_URL || 'http://localhost:3000'
    ).replace(/\/$/, '');
    const quoteUrl = `${appUrl}/quotes/${quote.id}`;

    const { pdfBuffer } = await this.quotePdf.getOrCreatePdfForQuote(id);

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

    const totalStr = `${money(quote.total)} ${quote.currency || 'USD'}`;

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827;">
        <h2 style="margin:0 0 8px;">Commercial Offer</h2>
        <p style="margin:0 0 16px; color:#374151;">
          Hello ${quote.client.contactName || quote.client.name || ''},
        </p>

        <div style="padding:12px 14px; border:1px solid #e5e7eb; border-radius:12px; background:#f9fafb;">
          <div><b>Offer:</b> ${quote.number}</div>
          <div><b>Total:</b> ${totalStr}</div>
        </div>

        <p style="margin:16px 0; color:#374151;">
          PDF attached. You can also view online:
        </p>

        <p style="margin:0 0 20px;">
          <a href="${quoteUrl}" style="display:inline-block; padding:10px 14px; background:#111827; color:#fff; text-decoration:none; border-radius:999px;">
            View offer
          </a>
        </p>

        <p style="margin:0; color:#6b7280; font-size:12px;">
          Sent from ${orgName}
        </p>
      </div>
    `;

    const info = await this.email.sendMail({
      to,
      subject,
      html,
      text: `Commercial Offer ${quote.number}\nTotal: ${totalStr}\nView: ${quoteUrl}`,
      attachments: [
        {
          filename: `quote-${quote.number}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    const beforeStatus = quote.status;

    const updated = await this.prisma.quote.update({
      where: { id },
      data: {
        status: QuoteStatus.SENT,
        sentAt: new Date(),
        lastEmailedTo: to,
        emailMessageId: info?.messageId ?? null,
      },
      include: { client: true, items: true },
    });

    await this.activity.create({
      organizationId: quote.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.QUOTE,
      entityId: quote.id,
      eventType: ActivityEventType.SENT,
      toEmail: to,
      meta: { quoteNumber: quote.number, subject, total: totalStr },
    });

    await this.logStatusChange({
      organizationId: quote.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.QUOTE,
      entityId: quote.id,
      from: beforeStatus,
      to: QuoteStatus.SENT,
      meta: { via: 'sendQuoteByEmail' },
    });

    return updated;
  }

  // =========================
  // ✅ CONVERT TO INVOICE
  // =========================
  async convertToInvoice(authUserId: string, quoteId: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    await this.plan.assertOrgAccess(dbUserId, quote.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId);

    const safeSuffix = quoteId.slice(-4).toUpperCase();
    const invoiceNumber = `INV-CONV-${quote.number}-${safeSuffix}`;

    const beforeStatus = quote.status;

    const invoice = await this.prisma.$transaction(async (tx) => {
      const createdInvoice = await tx.invoice.create({
        data: {
          organizationId: quote.organizationId,
          createdById: dbUserId,
          clientId: quote.clientId,
          number: invoiceNumber,
          issueDate: new Date(),
          dueDate: null,
          currency: quote.currency || 'USD',
          status: InvoiceStatus.DRAFT,
          subtotal: quote.subtotal,
          taxAmount: quote.taxAmount,
          total: quote.total,
          notes: quote.notes ?? null,
          items: {
            create: quote.items.map((it) => ({
              name: it.name,
              description: it.description ?? null,
              quantity: it.quantity,
              unitPrice: it.unitPrice as any,
              taxRate: it.taxRate ?? null,
              lineTotal: it.lineTotal as any,
            })),
          },
        },
        include: { items: true, client: true },
      });

      await tx.quote.update({
        where: { id: quoteId },
        data: {
          status: QuoteStatus.CONVERTED,
          convertedInvoiceId: createdInvoice.id,
        },
      });

      return createdInvoice;
    });

    await this.logStatusChange({
      organizationId: quote.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.QUOTE,
      entityId: quote.id,
      from: beforeStatus,
      to: QuoteStatus.CONVERTED,
      meta: {
        quoteNumber: quote.number,
        convertedInvoiceId: invoice.id,
        convertedInvoiceNumber: invoice.number,
        via: 'convertToInvoice',
      },
    });

    await this.activity.create({
      organizationId: quote.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.INVOICE,
      entityId: invoice.id,
      eventType: ActivityEventType.CREATED,
      meta: {
        invoiceNumber: invoice.number,
        fromQuoteId: quote.id,
        fromQuoteNumber: quote.number,
        via: 'convertToInvoice',
      },
    });

    return invoice;
  }

  // =========================
  // ✅ PDF (BASIC/PRO)
  // =========================
  async getQuotePdf(authUserId: string, quoteId: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      select: { id: true, organizationId: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    await this.plan.assertOrgAccess(dbUserId, quote.organizationId);

    const planId = await this.plan.getPlanIdForUser(dbUserId);
    this.plan.assertCanUseQuotes(planId);

    return this.quotePdf.getOrCreatePdfForQuote(quoteId);
  }
}
