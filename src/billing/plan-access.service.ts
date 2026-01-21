import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PlanId } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PlanSnapshot = {
  planId: PlanId;
};

type LimitResult = { allowed: true } | { allowed: false; reason: string };

@Injectable()
export class PlanAccessService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- AUTH -> DB USER ----------
  async resolveDbUserId(authUserId: string): Promise<string> {
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

  // ---------- OWNER-ONLY ORG ACCESS ----------
  async assertOrgOwner(dbUserId: string, organizationId: string) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, ownerId: true },
    });

    if (!org) throw new BadRequestException('Organization not found');
    if (org.ownerId !== dbUserId) {
      throw new ForbiddenException(
        'No access to this organization (owner-only)',
      );
    }
  }

  async getUserPlan(dbUserId: string): Promise<PlanSnapshot> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId: dbUserId },
      select: { planId: true },
    });

    return { planId: sub?.planId ?? PlanId.FREE };
  }

  // ---------- LIMITS CONFIG ----------
  private isUnlimited(planId: PlanId) {
    return planId === PlanId.PRO;
  }

  private limits(planId: PlanId) {
    // ✅ твоя матриця з PLANS
    if (planId === PlanId.FREE) {
      return {
        clientsMax: 3,
        invoicesPerMonthMax: 3,
        documentsMax: 3,

        canSendEmail: false,
        canSendInvoiceReminders: false,
        canUseActs: false,
        canUseQuotes: false,

        aiRequestsPerMonthMax: 5,
        canUseAdvancedAnalytics: false,
        canExport: false,
      };
    }

    if (planId === PlanId.BASIC) {
      return {
        clientsMax: 20,
        invoicesPerMonthMax: 20,
        documentsMax: 20,

        canSendEmail: true,
        canSendInvoiceReminders: false,
        canUseActs: true,
        canUseQuotes: true,

        aiRequestsPerMonthMax: 50,
        canUseAdvancedAnalytics: false,
        canExport: false,
      };
    }

    // PRO
    return {
      clientsMax: Infinity,
      invoicesPerMonthMax: Infinity,
      documentsMax: Infinity,

      canSendEmail: true,
      canSendInvoiceReminders: true, // "ручні нагадування"
      canUseActs: true,
      canUseQuotes: true,

      aiRequestsPerMonthMax: Infinity,
      canUseAdvancedAnalytics: true,
      canExport: true,
    };
  }

  // ---------- COUNTERS ----------
  async countClients(organizationId: string) {
    return this.prisma.client.count({ where: { organizationId } });
  }

  async countDocuments(organizationId: string) {
    return this.prisma.document.count({ where: { organizationId } });
  }

  private monthRange(d = new Date()) {
    const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
    return { from, to };
  }

  async countInvoicesCreatedInCurrentMonth(organizationId: string) {
    const { from, to } = this.monthRange(new Date());
    return this.prisma.invoice.count({
      where: { organizationId, createdAt: { gte: from, lt: to } },
    });
  }

  // AI ліміт — у схемі немає таблиці “aiRequests”, тому робимо pragmatic:
  // рахуємо USER messages за місяць у chatMessage (через session.createdById).
  async countChatUserMessagesInCurrentMonth(dbUserId: string) {
    const { from, to } = this.monthRange(new Date());
    return this.prisma.chatMessage.count({
      where: {
        role: 'USER' as any,
        createdAt: { gte: from, lt: to },
        session: {
          createdById: dbUserId,
        },
      },
    });
  }

  // ---------- ASSERT HELPERS ----------
  private asLimit(res: LimitResult) {
    if (!res.allowed) throw new BadRequestException(res.reason);
  }

  async assertCanCreateClient(dbUserId: string, organizationId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);

    if (this.isUnlimited(planId)) return;

    const current = await this.countClients(organizationId);
    if (current >= lim.clientsMax) {
      throw new BadRequestException(
        `Client limit reached for plan ${planId}. Max: ${lim.clientsMax}`,
      );
    }
  }

  async assertCanUploadDocument(dbUserId: string, organizationId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);

    if (this.isUnlimited(planId)) return;

    const current = await this.countDocuments(organizationId);
    if (current >= lim.documentsMax) {
      throw new BadRequestException(
        `Documents limit reached for plan ${planId}. Max: ${lim.documentsMax}`,
      );
    }
  }

  async assertCanCreateInvoice(dbUserId: string, organizationId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);

    if (this.isUnlimited(planId)) return;

    const current =
      await this.countInvoicesCreatedInCurrentMonth(organizationId);
    if (current >= lim.invoicesPerMonthMax) {
      throw new BadRequestException(
        `Monthly invoice limit reached for plan ${planId}. Max/month: ${lim.invoicesPerMonthMax}`,
      );
    }
  }

  async assertCanGenerateInvoicePdf(dbUserId: string) {
    // PDF інвойса — частина “інвойси + PDF”, дозволено у FREE/BASIC/PRO,
    // але FREE обмежується кількістю створених інвойсів/місяць (і ми вже гейтимо create).
    // Тому тут тільки базова перевірка: план існує.
    await this.getUserPlan(dbUserId);
  }

  async assertCanSendEmail(dbUserId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);
    if (!lim.canSendEmail) {
      throw new BadRequestException(
        `Email sending is not available on plan ${planId}`,
      );
    }
  }

  async assertCanSendInvoiceReminder(dbUserId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);
    if (!lim.canSendInvoiceReminders) {
      throw new BadRequestException(
        `Invoice reminders are not available on plan ${planId}`,
      );
    }
  }

  async assertCanUseActs(dbUserId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);
    if (!lim.canUseActs) {
      throw new BadRequestException(`Acts are not available on plan ${planId}`);
    }
  }

  async assertCanUseQuotes(dbUserId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);
    if (!lim.canUseQuotes) {
      throw new BadRequestException(
        `Quotes are not available on plan ${planId}`,
      );
    }
  }

  async assertCanUseAi(dbUserId: string) {
    const { planId } = await this.getUserPlan(dbUserId);
    const lim = this.limits(planId);

    if (this.isUnlimited(planId)) return;

    const current = await this.countChatUserMessagesInCurrentMonth(dbUserId);
    if (current >= lim.aiRequestsPerMonthMax) {
      throw new BadRequestException(
        `AI request limit reached for plan ${planId}. Max/month: ${lim.aiRequestsPerMonthMax}`,
      );
    }
  }

  async getPlanForFrontend(authUserId: string) {
    const dbUserId = await this.resolveDbUserId(authUserId);
    const { planId } = await this.getUserPlan(dbUserId);

    const lim = this.limits(planId);
    return {
      planId,
      limits: {
        clientsMax: Number.isFinite(lim.clientsMax) ? lim.clientsMax : null,
        invoicesPerMonthMax: Number.isFinite(lim.invoicesPerMonthMax)
          ? lim.invoicesPerMonthMax
          : null,
        documentsMax: Number.isFinite(lim.documentsMax)
          ? lim.documentsMax
          : null,
        aiRequestsPerMonthMax: Number.isFinite(lim.aiRequestsPerMonthMax)
          ? lim.aiRequestsPerMonthMax
          : null,
        canSendEmail: lim.canSendEmail,
        canSendInvoiceReminders: lim.canSendInvoiceReminders,
        canUseActs: lim.canUseActs,
        canUseQuotes: lim.canUseQuotes,
        canUseAdvancedAnalytics: lim.canUseAdvancedAnalytics,
        canExport: lim.canExport,
      },
    };
  }
}
