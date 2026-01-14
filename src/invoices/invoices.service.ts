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
import { InvoiceStatus, Prisma } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { InvoicePdfService } from './invoice-pdf.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly invoicePdf: InvoicePdfService,
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
    // Prisma P2002: Unique constraint failed
    return (
      e &&
      e.code === 'P2002' &&
      e.meta &&
      Array.isArray(e.meta.target) &&
      e.meta.target.includes('number')
    );
  }

  async sendInvoiceByEmail(id: string, variant: 'ua' | 'international' = 'ua') {
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

    // ===== PDF variant =====
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
      // Prisma.Decimal
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

    // ✅ статус + дата відправки
    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.SENT,
        sentAt: new Date(),
      },
      include: {
        items: true,
        client: true,
      },
    });
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
    items: {
      quantity: number;
      unitPrice: number;
      taxRate?: number;
    }[],
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

    return {
      subtotal,
      taxAmount,
      total,
      lineTotals,
    };
  }

  /**
   * ✅ Create invoice:
   * - createdByAuthUserId приходить з Clerk guard (req.authUserId)
   * - мапимо його на нашого User.id
   *
   * ✅ FIX:
   * - number унікальний тепер в межах organizationId
   * - додано ретрай на P2002, якщо 2 запити одночасно згенерили однаковий number
   */
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

    if (!createdByAuthUserId) {
      throw new BadRequestException('auth user id is required');
    }

    const createdByUser = await this.prisma.user.findUnique({
      where: { authUserId: createdByAuthUserId },
      select: { id: true },
    });

    if (!createdByUser) {
      throw new NotFoundException('User not found (sync user first)');
    }

    if (!items || items.length === 0) {
      throw new BadRequestException(
        'Потрібно додати хоча б одну позицію інвойсу',
      );
    }

    const issueDateParsed = this.parseDate(issueDate) ?? new Date();
    const dueDateParsed = this.parseDate(dueDate);

    const { subtotal, taxAmount, total, lineTotals } =
      this.calculateTotals(items);

    // ✅ Ретрай: якщо два запити одночасно створили один номер — пробуємо ще раз
    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const number = await this.generateInvoiceNumber(organizationId);

      try {
        return await this.prisma.invoice.create({
          data: {
            organizationId,
            createdById: createdByUser.id,
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
          include: {
            items: true,
            client: true,
          },
        });
      } catch (e: any) {
        lastError = e;

        // якщо номер уже зайнятий — повторюємо
        if (this.isUniqueNumberError(e) && attempt < maxAttempts) {
          continue;
        }

        // інші помилки — кидаємо як є
        throw e;
      }
    }

    throw new InternalServerErrorException(
      `Не вдалося створити інвойс через конфлікт нумерації (P2002). Спробуйте ще раз.`,
    );
  }

  async findAll(params: {
    organizationId: string;
    status?: InvoiceStatus;
    clientId?: string;
  }) {
    const { organizationId, status, clientId } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    return this.prisma.invoice.findMany({
      where: {
        organizationId,
        status,
        clientId: clientId ?? undefined,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        items: true,
        client: true,
      },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Інвойс не знайдено');
    }

    return invoice;
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const existing = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Інвойс не знайдено');
    }

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

    return this.prisma.$transaction(async (tx) => {
      if (hasItemsUpdate) {
        await tx.invoiceItem.deleteMany({
          where: {
            invoiceId: id,
          },
        });
      }

      const updated = await tx.invoice.update({
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
            hasItemsUpdate && itemsCreate
              ? {
                  create: itemsCreate,
                }
              : undefined,
        },
        include: {
          items: true,
          client: true,
        },
      });

      return updated;
    });
  }

  async remove(id: string) {
    await this.prisma.invoiceItem.deleteMany({
      where: { invoiceId: id },
    });

    return this.prisma.invoice.delete({
      where: { id },
    });
  }

  async send(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException('Інвойс не знайдено');
    }

    if (
      invoice.status === InvoiceStatus.PAID ||
      invoice.status === InvoiceStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Не можна відправити інвойс зі статусом ${invoice.status}`,
      );
    }

    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.SENT,
        sentAt: new Date(),
      },
      include: {
        items: true,
        client: true,
      },
    });
  }

  async markPaid(id: string, dto: MarkInvoicePaidDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException('Інвойс не знайдено');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Скасований інвойс не можна оплатити');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Інвойс вже має статус PAID');
    }

    const paidAt =
      dto.paidAt != null
        ? (this.parseDate(dto.paidAt) ?? new Date())
        : new Date();

    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.PAID,
        paidAt,
      },
      include: {
        items: true,
        client: true,
      },
    });
  }

  async cancel(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException('Інвойс не знайдено');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Оплачений інвойс не можна скасувати');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Інвойс вже скасовано');
    }

    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.CANCELLED,
      },
      include: {
        items: true,
        client: true,
      },
    });
  }

  async getAnalytics(params: {
    organizationId: string;
    from?: string;
    to?: string;
  }) {
    const { organizationId, from, to } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
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
        issueDate: {
          gte: dateFrom,
          lte: dateTo,
        },
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
      if (v && typeof v.toNumber === 'function') {
        return v.toNumber();
      }
      return 0;
    };

    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalOverdue = 0;

    const monthMap = new Map<
      string,
      {
        issuedTotal: number;
        paidTotal: number;
      }
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
      if (!monthMap.has(issueKey)) {
        monthMap.set(issueKey, { issuedTotal: 0, paidTotal: 0 });
      }
      monthMap.get(issueKey)!.issuedTotal += amount;

      if (inv.status === InvoiceStatus.PAID && inv.paidAt) {
        const paidKey = getMonthKey(inv.paidAt);
        if (!monthMap.has(paidKey)) {
          monthMap.set(paidKey, { issuedTotal: 0, paidTotal: 0 });
        }
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
