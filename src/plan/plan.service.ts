import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PlanId } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Period = { from: Date; to: Date };

function monthPeriod(d = new Date()): Period {
  const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
  return { from, to };
}

@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------
  // authUserId -> db userId
  // --------------------------
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

  assertCanUseTaxCalendar(plan: PlanId) {
    if (plan === PlanId.FREE) {
      throw new ForbiddenException('Tax calendar is available on BASIC/PRO');
    }
  }

  // --------------------------
  // Plan
  // --------------------------
  async getPlanIdForUser(userId: string): Promise<PlanId> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
      select: { planId: true },
    });

    return (sub?.planId as PlanId) ?? PlanId.FREE;
  }

  // --------------------------
  // Org access (owner-only fallback)
  // --------------------------
  async assertOrgAccess(userId: string, organizationId: string) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { id: true },
    });

    if (membership) return;

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true },
    });

    if (!org) throw new BadRequestException('Organization not found');

    if (org.ownerId !== userId) {
      throw new ForbiddenException('No access to this organization');
    }
  }

  // --------------------------
  // Limits map (matches your PLANS)
  // --------------------------
  private clientsLimit(plan: PlanId) {
    if (plan === PlanId.FREE) return 3;
    if (plan === PlanId.BASIC) return 20;
    return Infinity;
  }

  private documentsLimit(plan: PlanId) {
    if (plan === PlanId.FREE) return 3;
    if (plan === PlanId.BASIC) return 20;
    return Infinity;
  }

  private invoicesLimit(plan: PlanId) {
    if (plan === PlanId.FREE) return { type: 'total' as const, value: 3 };
    if (plan === PlanId.BASIC) return { type: 'month' as const, value: 20 };
    return { type: 'none' as const, value: Infinity };
  }

  private aiLimit(plan: PlanId) {
    if (plan === PlanId.FREE) return 5;
    if (plan === PlanId.BASIC) return 50;
    return Infinity;
  }

  // --------------------------
  // Feature gating
  // --------------------------
  assertCanSendEmail(plan: PlanId) {
    if (plan === PlanId.FREE) {
      throw new ForbiddenException('Email sending is available on BASIC/PRO');
    }
  }

  assertCanUseInvoiceReminders(plan: PlanId) {
    if (plan !== PlanId.PRO) {
      throw new ForbiddenException('Invoice reminders are available on PRO');
    }
  }

  assertCanUseRecurringInvoices(plan: PlanId) {
    if (plan !== PlanId.PRO) {
      throw new ForbiddenException('Recurring invoices are available on PRO');
    }
  }

  assertCanUseActs(plan: PlanId) {
    if (plan === PlanId.FREE) {
      throw new ForbiddenException('Acts are available on BASIC/PRO');
    }
  }

  assertCanUseQuotes(plan: PlanId) {
    if (plan === PlanId.FREE) {
      throw new ForbiddenException('Quotes are available on BASIC/PRO');
    }
  }

  // --------------------------
  // Count limits
  // --------------------------
  async assertClientsLimit(userId: string, organizationId: string) {
    const plan = await this.getPlanIdForUser(userId);
    const limit = this.clientsLimit(plan);
    if (!Number.isFinite(limit)) return;

    const count = await this.prisma.client.count({ where: { organizationId } });

    if (count >= limit) {
      throw new ForbiddenException(
        `Clients limit reached for plan ${plan}: ${limit}`,
      );
    }
  }

  async assertDocumentsLimit(userId: string, organizationId: string) {
    const plan = await this.getPlanIdForUser(userId);
    const limit = this.documentsLimit(plan);
    if (!Number.isFinite(limit)) return;

    const count = await this.prisma.document.count({
      where: { organizationId },
    });

    if (count >= limit) {
      throw new ForbiddenException(
        `Documents limit reached for plan ${plan}: ${limit}`,
      );
    }
  }

  async assertInvoicesLimit(userId: string, organizationId: string) {
    const plan = await this.getPlanIdForUser(userId);
    const lim = this.invoicesLimit(plan);

    if (lim.type === 'none') return;

    if (lim.type === 'total') {
      const count = await this.prisma.invoice.count({
        where: { organizationId },
      });
      if (count >= lim.value) {
        throw new ForbiddenException(
          `Invoices limit reached for plan ${plan}: ${lim.value}`,
        );
      }
      return;
    }

    const { from, to } = monthPeriod();
    const count = await this.prisma.invoice.count({
      where: { organizationId, createdAt: { gte: from, lt: to } },
    });

    if (count >= lim.value) {
      throw new ForbiddenException(
        `Monthly invoices limit reached for plan ${plan}: ${lim.value}/month`,
      );
    }
  }

  async assertAiQuota(userId: string, organizationId: string) {
    const plan = await this.getPlanIdForUser(userId);
    const limit = this.aiLimit(plan);
    if (!Number.isFinite(limit)) return;

    const { from, to } = monthPeriod();

    const used = await this.prisma.chatMessage.count({
      where: {
        role: 'USER' as any,
        createdAt: { gte: from, lt: to },
        session: { organizationId },
      },
    });

    if (used >= limit) {
      throw new ForbiddenException(
        `AI quota reached for plan ${plan}: ${limit}/month`,
      );
    }
  }
}
