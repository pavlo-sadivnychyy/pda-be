import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type CreateActFromInvoiceInput = {
  invoiceId: string;
  number: string;
  title?: string;
  periodFrom?: string;
  periodTo?: string;
  notes?: string;
  createdByAuthUserId: string; // ✅ тепер це Clerk userId
};

@Injectable()
export class ActsService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromInvoice(input: CreateActFromInvoiceInput) {
    const {
      invoiceId,
      number,
      title,
      periodFrom,
      periodTo,
      notes,
      createdByAuthUserId,
    } = input;

    if (!number) {
      throw new BadRequestException('Поле number (номер акта) є обовʼязковим');
    }

    // ✅ 1) знайти твого юзера в БД по Clerk authUserId
    const createdByUser = await this.prisma.user.findUnique({
      where: { authUserId: createdByAuthUserId },
      select: { id: true },
    });

    if (!createdByUser) {
      throw new NotFoundException('User not found (sync user first)');
    }

    // ✅ 2) підтягнути invoice
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true, organization: true },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    if (!invoice.clientId) {
      throw new BadRequestException(
        'В інвойса немає клієнта, неможливо створити акт',
      );
    }

    const act = await this.prisma.act.create({
      data: {
        organizationId: invoice.organizationId,
        clientId: invoice.clientId,
        createdById: createdByUser.id, // ✅ тут вже твій User.id
        number,
        title: title ?? `Акт наданих послуг за інвойсом № ${invoice.number}`,
        periodFrom: periodFrom ? new Date(periodFrom) : null,
        periodTo: periodTo ? new Date(periodTo) : null,
        total: invoice.total,
        currency: invoice.currency,
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

  async remove(id: string) {
    const existing = await this.prisma.act.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Акт не знайдено');
    return this.prisma.act.delete({ where: { id } });
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

    if (!act) throw new NotFoundException('Акт не знайдено');
    return { act };
  }
}
