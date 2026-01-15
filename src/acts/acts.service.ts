import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActStatus,
  ActivityEntityType,
  ActivityEventType,
} from '@prisma/client';
import { EmailService } from '../email/email.service';
import { ActPdfService } from './act-pdf.service';
import { ActivityService } from '../activity/activity.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly actPdf: ActPdfService,
    private readonly activity: ActivityService,
  ) {}

  private isUniqueActNumberError(e: any): boolean {
    return (
      e &&
      e.code === 'P2002' &&
      e.meta &&
      Array.isArray(e.meta.target) &&
      e.meta.target.includes('number')
    );
  }

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

  private async assertOrgAccess(dbUserId: string, organizationId: string) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId: dbUserId, organizationId } },
      select: { id: true },
    });

    if (!membership) {
      throw new BadRequestException('No access to this organization');
    }
  }

  private async logStatusChange(params: {
    organizationId: string;
    actorUserId: string;
    actId: string;
    from: any;
    to: any;
    meta?: any;
  }) {
    if (String(params.from) === String(params.to)) return;

    await this.activity.create({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      entityType: ActivityEntityType.ACT,
      entityId: params.actId,
      eventType: ActivityEventType.STATUS_CHANGED,
      fromStatus: String(params.from),
      toStatus: String(params.to),
      meta: params.meta ?? undefined,
    });
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

    const createdByUser = await this.prisma.user.findUnique({
      where: { authUserId: createdByAuthUserId },
      select: { id: true },
    });

    if (!createdByUser) {
      throw new NotFoundException('User not found (sync user first)');
    }

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

      await this.activity.create({
        organizationId: act.organizationId,
        actorUserId: createdByUser.id,
        entityType: ActivityEntityType.ACT,
        entityId: act.id,
        eventType: ActivityEventType.CREATED,
        meta: {
          actNumber: act.number,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
        },
      });

      return act;
    } catch (e: any) {
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

  async sendActByEmail(authUserId: string, actId: string) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const act = await this.prisma.act.findUnique({
      where: { id: actId },
      include: {
        organization: true,
        client: true,
        relatedInvoice: true,
        pdfDocument: true,
      },
    });

    if (!act) throw new NotFoundException('Акт не знайдено');

    await this.assertOrgAccess(dbUserId, act.organizationId);

    if (act.status === ActStatus.SIGNED || act.status === ActStatus.CANCELLED) {
      throw new BadRequestException(
        `Не можна відправити акт зі статусом ${act.status}`,
      );
    }

    if (!act.client || !act.client.email) {
      throw new BadRequestException(
        'Client email is empty. Fill client.email first.',
      );
    }

    const to = act.client.email.trim();
    const orgName = act.organization?.name || 'Your company';

    const { pdfBuffer } = await this.actPdf.getOrCreatePdfForAct(act.id);

    const safeNumber = String(act.number).replace(/[^a-zA-Z0-9\-]/g, '_');
    const pdfName = `act-${safeNumber}.pdf`;

    const greeting = act.client.contactName || act.client.name || '';
    const relatedInvoiceText = act.relatedInvoice?.number
      ? ` за інвойсом № ${act.relatedInvoice.number}`
      : '';

    const subject = `Акт № ${act.number}${relatedInvoiceText} від ${orgName}`;

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827;">
        <h2>Акт наданих послуг</h2>

        <p>Вітаємо${greeting ? `, ${greeting}` : ''}!</p>

        <div style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;">
          <div><b>Акт:</b> № ${act.number}</div>
          ${
            act.relatedInvoice?.number
              ? `<div><b>Інвойс:</b> № ${act.relatedInvoice.number}</div>`
              : ''
          }
        </div>

        <p style="margin-top:16px;">
          PDF акта у вкладенні цього листа.
        </p>

        <p style="margin-top:16px;font-size:12px;color:#6b7280;">
          Sent from ${orgName}
        </p>
      </div>
    `;

    await this.email.sendMail({
      to,
      subject,
      html,
      text: `Акт № ${act.number}\nPDF у вкладенні`,
      attachments: [
        {
          filename: pdfName,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    const beforeStatus = act.status;

    const updated = await this.prisma.act.update({
      where: { id: actId },
      data: { status: ActStatus.SENT },
      include: { client: true, relatedInvoice: true },
    });

    await this.activity.create({
      organizationId: act.organizationId,
      actorUserId: dbUserId,
      entityType: ActivityEntityType.ACT,
      entityId: act.id,
      eventType: ActivityEventType.SENT,
      toEmail: to,
      meta: { actNumber: act.number, subject },
    });

    await this.logStatusChange({
      organizationId: act.organizationId,
      actorUserId: dbUserId,
      actId: act.id,
      from: beforeStatus,
      to: ActStatus.SENT,
      meta: { via: 'sendActByEmail' },
    });

    return { act: updated };
  }
}
