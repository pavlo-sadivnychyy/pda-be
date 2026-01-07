import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { MarkInvoicePaidDto } from './dto/mark-invoice-paid.dto';
import { InvoiceStatus, Prisma } from '@prisma/client';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDate(dateStr?: string): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Невалідна дата: ${dateStr}`);
    }
    return d;
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

  async create(dto: CreateInvoiceDto) {
    const {
      organizationId,
      createdById,
      items,
      clientId,
      issueDate,
      dueDate,
      currency,
      status,
      notes,
    } = dto;

    if (!organizationId || !createdById) {
      throw new BadRequestException(
        'organizationId та createdById є обовʼязковими',
      );
    }

    if (!items || items.length === 0) {
      throw new BadRequestException(
        'Потрібно додати хоча б одну позицію інвойсу',
      );
    }

    const issueDateParsed = this.parseDate(issueDate) ?? new Date();
    const dueDateParsed = this.parseDate(dueDate);

    const number = await this.generateInvoiceNumber(organizationId);
    const { subtotal, taxAmount, total, lineTotals } =
      this.calculateTotals(items);

    return this.prisma.invoice.create({
      data: {
        organizationId,
        createdById,
        clientId: clientId ?? null,
        number,
        issueDate: issueDateParsed,
        dueDate: dueDateParsed ?? null,
        currency: currency ?? 'UAH',

        subtotal,
        taxAmount,
        total,

        status: status ?? InvoiceStatus.DRAFT,
        notes: notes ?? null,

        // нові поля
        sentAt: null,
        paidAt: null,

        items: {
          create: items.map((item, index) => ({
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

  // ============ НОВІ МЕТОДИ ЖИТТЄВОГО ЦИКЛУ ============

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

    // За замовчуванням — останні 6 місяців
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
      // Prisma.Decimal
      // @ts-ignore
      if (v && typeof v.toNumber === 'function') {
        // @ts-ignore
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
      return `${y}-${m.toString().padStart(2, '0')}`; // 2026-01
    };

    let currency: string | null = null;

    for (const inv of invoices) {
      const amount = toNumber(inv.total);
      currency = currency || inv.currency || null;

      // Загальні суми
      if (inv.status === InvoiceStatus.PAID) {
        totalPaid += amount;
      }
      if (
        inv.status === InvoiceStatus.SENT ||
        inv.status === InvoiceStatus.OVERDUE
      ) {
        totalOutstanding += amount;
      }
      if (inv.status === InvoiceStatus.OVERDUE) {
        totalOverdue += amount;
      }

      // Виставлено по місяцях (issueDate)
      const issueKey = getMonthKey(inv.issueDate);
      if (!monthMap.has(issueKey)) {
        monthMap.set(issueKey, { issuedTotal: 0, paidTotal: 0 });
      }
      monthMap.get(issueKey)!.issuedTotal += amount;

      // Оплачено по місяцях (paidAt, якщо є)
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
        month, // '2026-01'
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
