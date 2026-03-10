import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseItemType, ExpensePlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';
import {
  CreateExpenseCategoryDto,
  CreateExpenseItemDto,
  CreateExpenseRecurringRuleDto,
  EnsureExpenseMonthDto,
  ListExpenseMonthsQueryDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseItemDto,
  UpdateExpenseMonthDto,
  UpdateExpenseRecurringRuleDto,
} from './expense-planner.dto';
import {
  buildHistoryAnalytics,
  buildMonthAnalytics,
} from './expense-planner.analytics';

const DEFAULT_CATEGORIES = [
  {
    name: 'Їжа',
    icon: 'utensils',
    color: '#22c55e',
    sortOrder: 1,
    isSystem: true,
  },
  {
    name: 'Транспорт',
    icon: 'car',
    color: '#3b82f6',
    sortOrder: 2,
    isSystem: true,
  },
  {
    name: 'Житло',
    icon: 'home',
    color: '#f59e0b',
    sortOrder: 3,
    isSystem: true,
  },
  {
    name: 'Реклама',
    icon: 'megaphone',
    color: '#ef4444',
    sortOrder: 4,
    isSystem: true,
  },
  {
    name: 'Софт',
    icon: 'laptop',
    color: '#8b5cf6',
    sortOrder: 5,
    isSystem: true,
  },
  {
    name: 'Податки',
    icon: 'receipt',
    color: '#06b6d4',
    sortOrder: 6,
    isSystem: true,
  },
  {
    name: 'Інше',
    icon: 'folder',
    color: '#6b7280',
    sortOrder: 7,
    isSystem: true,
  },
];

function parseMonthKey(monthKey: string): Date {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function monthKeyFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function toDateOnlyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function decimal(value?: number | null): Prisma.Decimal | undefined {
  if (value === null || value === undefined) return undefined;
  return new Prisma.Decimal(value);
}

@Injectable()
export class ExpensePlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planService: PlanService,
  ) {}

  private async resolveUserId(authUserId: string): Promise<string> {
    return this.planService.resolveDbUserId(authUserId);
  }

  private async ensurePlanBelongsToUser(userId: string, planId: string) {
    const plan = await this.prisma.expenseMonthPlan.findFirst({
      where: { id: planId, userId },
    });

    if (!plan) {
      throw new NotFoundException('Expense month plan not found');
    }

    return plan;
  }

  private async ensureCategoryBelongsToUser(
    userId: string,
    categoryId: string,
  ) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, userId },
    });

    if (!category) {
      throw new NotFoundException('Expense category not found');
    }

    return category;
  }

  private async ensureItemBelongsToUser(userId: string, itemId: string) {
    const item = await this.prisma.expenseItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException('Expense item not found');
    }

    return item;
  }

  private async ensureRecurringBelongsToUser(userId: string, ruleId: string) {
    const rule = await this.prisma.expenseRecurringRule.findFirst({
      where: { id: ruleId, userId },
    });

    if (!rule) {
      throw new NotFoundException('Recurring rule not found');
    }

    return rule;
  }

  private async seedDefaultCategories(userId: string) {
    const count = await this.prisma.expenseCategory.count({
      where: { userId, planId: null },
    });

    if (count > 0) return;

    await this.prisma.expenseCategory.createMany({
      data: DEFAULT_CATEGORIES.map((x) => ({
        userId,
        planId: null,
        name: x.name,
        icon: x.icon,
        color: x.color,
        sortOrder: x.sortOrder,
        isSystem: x.isSystem,
        isActive: true,
      })),
    });
  }

  async ensureMonth(authUserId: string, dto: EnsureExpenseMonthDto) {
    const userId = await this.resolveUserId(authUserId);

    await this.seedDefaultCategories(userId);

    const monthDate = parseMonthKey(dto.monthKey);

    const plan = await this.prisma.expenseMonthPlan.upsert({
      where: {
        userId_monthKey: {
          userId,
          monthKey: dto.monthKey,
        },
      },
      update: {
        currency: dto.currency ?? undefined,
      },
      create: {
        userId,
        monthKey: dto.monthKey,
        monthDate,
        currency: dto.currency ?? 'UAH',
        status: ExpensePlanStatus.OPEN,
      },
    });

    await this.generateRecurringForMonthByUserId(userId, dto.monthKey);

    return this.getMonth(authUserId, dto.monthKey);
  }

  async updateMonth(
    authUserId: string,
    monthKey: string,
    dto: UpdateExpenseMonthDto,
  ) {
    const userId = await this.resolveUserId(authUserId);

    const plan = await this.prisma.expenseMonthPlan.findUnique({
      where: { userId_monthKey: { userId, monthKey } },
    });

    if (!plan) {
      throw new NotFoundException('Expense month plan not found');
    }

    await this.prisma.expenseMonthPlan.update({
      where: { id: plan.id },
      data: {
        incomePlanned:
          dto.incomePlanned !== undefined
            ? decimal(dto.incomePlanned)
            : undefined,
        incomeActual:
          dto.incomeActual !== undefined
            ? decimal(dto.incomeActual)
            : undefined,
        notes: dto.notes,
      },
    });

    return this.getMonth(authUserId, monthKey);
  }

  async getMonth(authUserId: string, monthKey: string) {
    const userId = await this.resolveUserId(authUserId);

    const plan = await this.prisma.expenseMonthPlan.findUnique({
      where: {
        userId_monthKey: { userId, monthKey },
      },
      include: {
        categories: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        items: {
          include: {
            category: true,
          },
          orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!plan) {
      throw new NotFoundException('Expense month plan not found');
    }

    const globalCategories = await this.prisma.expenseCategory.findMany({
      where: {
        userId,
        planId: null,
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const recurringRules = await this.prisma.expenseRecurringRule.findMany({
      where: { userId, isActive: true },
      include: { category: true },
      orderBy: [{ dayOfMonth: 'asc' }, { createdAt: 'asc' }],
    });

    const analytics = buildMonthAnalytics({
      monthKey: plan.monthKey,
      incomePlanned: plan.incomePlanned?.toString(),
      incomeActual: plan.incomeActual?.toString(),
      items: plan.items.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        amountPlanned: item.amountPlanned?.toString(),
        amountActual: item.amountActual?.toString(),
        expenseDate: item.expenseDate,
        category: item.category
          ? {
              id: item.category.id,
              name: item.category.name,
              color: item.category.color,
              icon: item.category.icon,
            }
          : null,
      })),
    });

    return {
      plan,
      globalCategories,
      recurringRules,
      analytics,
    };
  }

  async listMonths(authUserId: string, query: ListExpenseMonthsQueryDto) {
    const userId = await this.resolveUserId(authUserId);

    const where: Prisma.ExpenseMonthPlanWhereInput = { userId };

    if (query.from || query.to) {
      where.monthKey = {};
      if (query.from) where.monthKey.gte = query.from;
      if (query.to) where.monthKey.lte = query.to;
    }

    const months = await this.prisma.expenseMonthPlan.findMany({
      where,
      include: {
        items: {
          select: {
            type: true,
            amountPlanned: true,
            amountActual: true,
          },
        },
      },
      orderBy: { monthKey: 'asc' },
    });

    return {
      months,
      historyAnalytics: buildHistoryAnalytics(
        months.map((m) => ({
          monthKey: m.monthKey,
          incomePlanned: m.incomePlanned?.toString(),
          incomeActual: m.incomeActual?.toString(),
          items: m.items.map((i) => ({
            type: i.type,
            amountPlanned: i.amountPlanned?.toString(),
            amountActual: i.amountActual?.toString(),
          })),
        })),
      ),
    };
  }

  async createCategory(authUserId: string, dto: CreateExpenseCategoryDto) {
    const userId = await this.resolveUserId(authUserId);

    if (dto.planId) {
      await this.ensurePlanBelongsToUser(userId, dto.planId);
    }

    const category = await this.prisma.expenseCategory.create({
      data: {
        userId,
        planId: dto.planId ?? null,
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        sortOrder: dto.sortOrder ?? 0,
        isSystem: dto.isSystem ?? false,
      },
    });

    return { category };
  }

  async updateCategory(
    authUserId: string,
    id: string,
    dto: UpdateExpenseCategoryDto,
  ) {
    const userId = await this.resolveUserId(authUserId);
    await this.ensureCategoryBelongsToUser(userId, id);

    const category = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });

    return { category };
  }

  async deleteCategory(authUserId: string, id: string) {
    const userId = await this.resolveUserId(authUserId);
    await this.ensureCategoryBelongsToUser(userId, id);

    await this.prisma.$transaction([
      this.prisma.expenseItem.updateMany({
        where: { categoryId: id, userId },
        data: { categoryId: null },
      }),
      this.prisma.expenseRecurringRule.updateMany({
        where: { categoryId: id, userId },
        data: { categoryId: null },
      }),
      this.prisma.expenseCategory.delete({
        where: { id },
      }),
    ]);

    return { success: true };
  }

  async createItem(authUserId: string, dto: CreateExpenseItemDto) {
    const userId = await this.resolveUserId(authUserId);

    const plan = await this.ensurePlanBelongsToUser(userId, dto.planId);

    if (dto.categoryId) {
      await this.ensureCategoryBelongsToUser(userId, dto.categoryId);
    }

    if (
      dto.type === ExpenseItemTypeDto.ACTUAL &&
      dto.amountActual === undefined
    ) {
      throw new BadRequestException('amountActual is required for ACTUAL item');
    }

    if (
      dto.type === ExpenseItemTypeDto.PLANNED &&
      dto.amountPlanned === undefined
    ) {
      throw new BadRequestException(
        'amountPlanned is required for PLANNED item',
      );
    }

    const item = await this.prisma.expenseItem.create({
      data: {
        userId,
        planId: plan.id,
        categoryId: dto.categoryId ?? null,
        title: dto.title,
        note: dto.note,
        vendorName: dto.vendorName,
        type: dto.type as ExpenseItemType,
        amountPlanned: decimal(dto.amountPlanned),
        amountActual: decimal(dto.amountActual),
        currency: dto.currency ?? plan.currency,
        expenseDate: toDateOnlyUtc(dto.expenseDate),
        paidAt: dto.paidAt ? toDateOnlyUtc(dto.paidAt) : null,
      },
      include: {
        category: true,
      },
    });

    return { item };
  }

  async updateItem(authUserId: string, id: string, dto: UpdateExpenseItemDto) {
    const userId = await this.resolveUserId(authUserId);
    await this.ensureItemBelongsToUser(userId, id);

    if (dto.categoryId) {
      await this.ensureCategoryBelongsToUser(userId, dto.categoryId);
    }

    const item = await this.prisma.expenseItem.update({
      where: { id },
      data: {
        categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
        title: dto.title,
        note: dto.note,
        vendorName: dto.vendorName,
        type: dto.type as ExpenseItemType | undefined,
        amountPlanned:
          dto.amountPlanned === undefined
            ? undefined
            : dto.amountPlanned === null
              ? null
              : decimal(dto.amountPlanned),
        amountActual:
          dto.amountActual === undefined
            ? undefined
            : dto.amountActual === null
              ? null
              : decimal(dto.amountActual),
        currency: dto.currency,
        expenseDate: dto.expenseDate
          ? toDateOnlyUtc(dto.expenseDate)
          : undefined,
        paidAt:
          dto.paidAt === undefined
            ? undefined
            : dto.paidAt === null
              ? null
              : toDateOnlyUtc(dto.paidAt),
      },
      include: {
        category: true,
      },
    });

    return { item };
  }

  async deleteItem(authUserId: string, id: string) {
    const userId = await this.resolveUserId(authUserId);
    await this.ensureItemBelongsToUser(userId, id);

    await this.prisma.expenseItem.delete({ where: { id } });

    return { success: true };
  }

  async createRecurringRule(
    authUserId: string,
    dto: CreateExpenseRecurringRuleDto,
  ) {
    const userId = await this.resolveUserId(authUserId);

    if (dto.categoryId) {
      await this.ensureCategoryBelongsToUser(userId, dto.categoryId);
    }

    const rule = await this.prisma.expenseRecurringRule.create({
      data: {
        userId,
        categoryId: dto.categoryId ?? null,
        title: dto.title,
        note: dto.note,
        vendorName: dto.vendorName,
        amount: decimal(dto.amount)!,
        currency: dto.currency ?? 'UAH',
        dayOfMonth: dto.dayOfMonth,
        startMonthKey: dto.startMonthKey,
        endMonthKey: dto.endMonthKey ?? null,
        isActive: dto.isActive ?? true,
      },
      include: { category: true },
    });

    return { rule };
  }

  async updateRecurringRule(
    authUserId: string,
    id: string,
    dto: UpdateExpenseRecurringRuleDto,
  ) {
    const userId = await this.resolveUserId(authUserId);
    await this.ensureRecurringBelongsToUser(userId, id);

    if (dto.categoryId) {
      await this.ensureCategoryBelongsToUser(userId, dto.categoryId);
    }

    const rule = await this.prisma.expenseRecurringRule.update({
      where: { id },
      data: {
        categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
        title: dto.title,
        note: dto.note,
        vendorName: dto.vendorName,
        amount: dto.amount !== undefined ? decimal(dto.amount) : undefined,
        currency: dto.currency,
        dayOfMonth: dto.dayOfMonth,
        startMonthKey: dto.startMonthKey,
        endMonthKey:
          dto.endMonthKey === undefined ? undefined : dto.endMonthKey,
        isActive: dto.isActive,
      },
      include: { category: true },
    });

    return { rule };
  }

  async deleteRecurringRule(authUserId: string, id: string) {
    const userId = await this.resolveUserId(authUserId);
    await this.ensureRecurringBelongsToUser(userId, id);

    await this.prisma.expenseRecurringRule.delete({
      where: { id },
    });

    return { success: true };
  }

  async generateRecurringForMonth(authUserId: string, monthKey: string) {
    const userId = await this.resolveUserId(authUserId);
    return this.generateRecurringForMonthByUserId(userId, monthKey);
  }

  async generateRecurringForMonthByUserId(userId: string, monthKey: string) {
    const plan = await this.prisma.expenseMonthPlan.findUnique({
      where: {
        userId_monthKey: { userId, monthKey },
      },
    });

    if (!plan) {
      throw new NotFoundException('Expense month plan not found');
    }

    const rules = await this.prisma.expenseRecurringRule.findMany({
      where: {
        userId,
        isActive: true,
        startMonthKey: { lte: monthKey },
        OR: [{ endMonthKey: null }, { endMonthKey: { gte: monthKey } }],
      },
    });

    if (!rules.length) {
      return { generated: 0 };
    }

    const [year, month] = monthKey.split('-').map(Number);

    let generated = 0;

    for (const rule of rules) {
      const targetDate = new Date(
        Date.UTC(year, month - 1, Math.min(rule.dayOfMonth, 28), 0, 0, 0, 0),
      );

      const exists = await this.prisma.expenseItem.findFirst({
        where: {
          userId,
          planId: plan.id,
          recurringRuleId: rule.id,
        },
        select: { id: true },
      });

      if (exists) continue;

      await this.prisma.expenseItem.create({
        data: {
          userId,
          planId: plan.id,
          categoryId: rule.categoryId,
          title: rule.title,
          note: rule.note,
          vendorName: rule.vendorName,
          type: ExpenseItemType.PLANNED,
          amountPlanned: rule.amount,
          amountActual: null,
          currency: rule.currency,
          expenseDate: targetDate,
          isRecurringGenerated: true,
          recurringRuleId: rule.id,
        },
      });

      await this.prisma.expenseRecurringRule.update({
        where: { id: rule.id },
        data: {
          lastGeneratedMonthKey: monthKey,
        },
      });

      generated += 1;
    }

    return { generated };
  }

  async bootstrapCurrentAndNextMonthForAllUsers() {
    const users = await this.prisma.user.findMany({
      select: { id: true },
    });

    const now = new Date();
    const currentMonthKey = monthKeyFromDate(now);
    const nextMonthKey = monthKeyFromDate(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    );

    let plansEnsured = 0;
    let recurringGenerated = 0;

    for (const user of users) {
      await this.seedDefaultCategories(user.id);

      for (const mk of [currentMonthKey, nextMonthKey]) {
        const plan = await this.prisma.expenseMonthPlan.upsert({
          where: {
            userId_monthKey: { userId: user.id, monthKey: mk },
          },
          update: {},
          create: {
            userId: user.id,
            monthKey: mk,
            monthDate: parseMonthKey(mk),
            currency: 'UAH',
            status: ExpensePlanStatus.OPEN,
          },
        });

        if (plan) plansEnsured += 1;

        const res = await this.generateRecurringForMonthByUserId(user.id, mk);
        recurringGenerated += res.generated;
      }
    }

    return {
      users: users.length,
      plansEnsured,
      recurringGenerated,
    };
  }
}

enum ExpenseItemTypeDto {
  PLANNED = 'PLANNED',
  ACTUAL = 'ACTUAL',
}
