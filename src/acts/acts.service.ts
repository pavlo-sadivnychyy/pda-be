import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type CreateActFromInvoiceDto = {
  invoiceId: string;
  number: string; // номер акта
  title?: string;
  periodFrom?: string; // ISO
  periodTo?: string; // ISO
  notes?: string;
  createdById: string;
};

@Injectable()
export class ActsService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromInvoice(dto: CreateActFromInvoiceDto) {
    const {
      invoiceId,
      number,
      title,
      periodFrom,
      periodTo,
      notes,
      createdById,
    } = dto;

    if (!number) {
      throw new BadRequestException('Поле number (номер акта) є обовʼязковим');
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        organization: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Інвойс не знайдено');
    }

    if (!invoice.clientId) {
      throw new BadRequestException(
        'В інвойса немає клієнта, неможливо створити акт',
      );
    }

    const total = invoice.total;
    const currency = invoice.currency;

    const act = await this.prisma.act.create({
      data: {
        organizationId: invoice.organizationId,
        clientId: invoice.clientId,
        createdById,
        number,
        title: title ?? `Акт наданих послуг за інвойсом № ${invoice.number}`,
        periodFrom: periodFrom ? new Date(periodFrom) : null,
        periodTo: periodTo ? new Date(periodTo) : null,
        total,
        currency,
        notes: notes ?? '',
        relatedInvoiceId: invoice.id,
        status: 'DRAFT',
      },
    });

    return act;
  }

  async listForOrganization(organizationId: string) {
    if (!organizationId) {
      throw new BadRequestException('organizationId є обовʼязковим');
    }

    const items = await this.prisma.act.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        client: true,
        relatedInvoice: true,
      },
    });

    return { items };
  }

  async getById(id: string) {
    const act = await this.prisma.act.findUnique({
      where: { id },
      include: {
        client: true,
        organization: true,
        relatedInvoice: true,
      },
    });

    if (!act) {
      throw new NotFoundException('Акт не знайдено');
    }

    return { act };
  }
}
