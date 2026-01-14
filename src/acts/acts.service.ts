import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type CreateActFromInvoiceInput = {
  invoiceId: string;
  number: string;
  title?: string;
  periodFrom?: string;
  periodTo?: string;
  notes?: string;
  createdByAuthUserId: string; // Clerk userId
};

@Injectable()
export class ActsService {
  constructor(private readonly prisma: PrismaService) {}

  private isUniqueActNumberError(e: any): boolean {
    return (
      e &&
      e.code === 'P2002' &&
      e.meta &&
      Array.isArray(e.meta.target) &&
      e.meta.target.includes('number')
    );
  }

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

    const trimmedNumber = (number ?? '').trim();
    if (!trimmedNumber) {
      throw new BadRequestException('Поле number (номер акта) є обовʼязковим');
    }

    // 1) знайти юзера по Clerk authUserId
    const createdByUser = await this.prisma.user.findUnique({
      where: { authUserId: createdByAuthUserId },
      select: { id: true },
    });

    if (!createdByUser) {
      throw new NotFoundException('User not found (sync user first)');
    }

    // 2) підтягнути invoice
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

    // ✅ 3) перевірка на дубль номера В МЕЖАХ ОРГАНІЗАЦІЇ (людська помилка замість 500)
    const existingByNumber = await this.prisma.act.findFirst({
      where: {
        organizationId: invoice.organizationId,
        number: trimmedNumber,
      },
      select: { id: true },
    });

    if (existingByNumber) {
      throw new ConflictException(
        `Акт з номером "${trimmedNumber}" вже існує в цій організації`,
      );
    }

    // 4) create
    try {
      const act = await this.prisma.act.create({
        data: {
          organizationId: invoice.organizationId,
          clientId: invoice.clientId,
          createdById: createdByUser.id,
          number: trimmedNumber,
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
    } catch (e: any) {
      // якщо паралельний запит таки встиг створити цей номер
      if (this.isUniqueActNumberError(e)) {
        throw new ConflictException(
          `Акт з номером "${trimmedNumber}" вже існує в цій організації`,
        );
      }
      throw e;
    }
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
