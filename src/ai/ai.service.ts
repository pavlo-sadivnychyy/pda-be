import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';
import {
  ActStatus,
  ClientCrmStatus,
  InvoiceStatus,
  QuoteStatus,
} from '@prisma/client';

type ChatMessageInput = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type KnowledgeSnippet = {
  content: string;
  source: string;
};

type ToolCtx = {
  userId: string; // DB userId
  organizationId: string;
};

type AiSafeContext = {
  user?: {
    firstName?: string | null;
    fullName?: string | null;
    locale?: string | null;
    timezone?: string | null;
    jobTitle?: string | null;
    onboardingCompleted?: boolean;
    emailVerified?: boolean;
    createdAt?: string;
  };
  organization?: {
    name?: string;
    slug?: string;
    logoUrl?: string | null;
    industry?: string | null;
    description?: string | null;
    websiteUrl?: string | null;
    country?: string | null;
    city?: string | null;
    timeZone?: string | null;
    defaultLanguage?: string | null;
    defaultCurrency?: string | null;
    primaryContactName?: string | null;

    businessNiche?: string | null;
    servicesDescription?: string | null;
    targetAudience?: string | null;
    brandStyle?: string | null;
  };
  subscription?: {
    planId?: string;
    status?: string;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
  };
  documentsIndex?: Array<{
    title: string;
    description?: string | null;
    language?: string | null;
    tags: string[];
    source: string;
    status: string;
    mimeType: string;
    pages?: number | null;
    chunkCount?: number;
    createdAt: string;
    updatedAt: string;
  }>;
  kpis?: {
    totalClients: number;
    activeClients: number;
    openInvoices: number;
    overdueInvoices: number;
    overdueTotal: string;
    quotesDraftOrSent: number;
    actsDraftOrSent: number;
  };
  servicesCatalog?: Array<{
    id: string;
    name: string;
    description?: string | null;
    price: string;
    isActive: boolean;
  }>;
};

function safeJson(obj: unknown) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function money(value: any): string {
  if (value == null) return '0.00';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value === 'string') return value;
  // Prisma.Decimal
  // @ts-ignore
  if (typeof value?.toNumber === 'function') return value.toNumber().toFixed(2);
  // @ts-ignore
  if (typeof value?.toString === 'function') return value.toString();
  return String(value);
}

function maskEmail(email?: string | null) {
  if (!email) return null;
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const safeName =
    name.length <= 1 ? '*' : `${name[0]}***${name[name.length - 1] ?? ''}`;
  return `${safeName}@${domain}`;
}

function maskPhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `+****${digits.slice(-4)}`;
}

@Injectable()
export class AiService {
  private client: OpenAI;
  private chatModel: string;
  private embeddingModel: string;
  private embeddingTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

    this.client = new OpenAI({ apiKey });
    this.chatModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    this.embeddingModel =
      process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-small';

    this.embeddingTimeoutMs = Number(
      process.env.OPENAI_EMBEDDING_TIMEOUT_MS ?? 20000,
    );
  }

  // =========================
  // ✅ SAFE CONTEXT
  // =========================

  async buildSafeContext(params: {
    userId: string;
    organizationId: string;
    allowDocuments: boolean;
  }): Promise<AiSafeContext> {
    const { userId, organizationId, allowDocuments } = params;
    await this.plan.assertOrgAccess(userId, organizationId);

    const docsPromise = allowDocuments
      ? this.prisma.document.findMany({
          where: { organizationId },
          orderBy: { updatedAt: 'desc' },
          take: 30,
          select: {
            title: true,
            description: true,
            language: true,
            tags: true,
            source: true,
            status: true,
            mimeType: true,
            pages: true,
            chunkCount: true,
            createdAt: true,
            updatedAt: true,
            // ❌ storageKey не беремо
          },
        })
      : Promise.resolve([]);

    const [user, org, sub, docs, services, kpis] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          fullName: true,
          locale: true,
          timezone: true,
          jobTitle: true,
          onboardingCompleted: true,
          emailVerified: true,
          createdAt: true,
        },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          name: true,
          slug: true,
          logoUrl: true,
          industry: true,
          description: true,
          websiteUrl: true,
          country: true,
          city: true,
          timeZone: true,
          defaultLanguage: true,
          defaultCurrency: true,
          primaryContactName: true,

          businessNiche: true,
          servicesDescription: true,
          targetAudience: true,
          brandStyle: true,

          // ❌ реквізити/банківські дані НЕ беремо
        },
      }),
      this.prisma.subscription.findUnique({
        where: { userId },
        select: {
          planId: true,
          status: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          // ❌ paddle* не беремо
        },
      }),
      docsPromise,
      this.prisma.userService.findMany({
        where: { userId },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          isActive: true,
        },
      }),
      this.computeOrgKpis({ userId, organizationId }),
    ]);

    return {
      user: user
        ? { ...user, createdAt: user.createdAt?.toISOString() }
        : undefined,
      organization: org ?? undefined,
      subscription: sub
        ? {
            planId: sub.planId,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          }
        : undefined,
      documentsIndex: allowDocuments
        ? (docs as any[]).map((d) => ({
            title: d.title,
            description: d.description,
            language: d.language,
            tags: d.tags,
            source: d.source,
            status: d.status,
            mimeType: d.mimeType,
            pages: d.pages,
            chunkCount: d.chunkCount,
            createdAt: d.createdAt.toISOString(),
            updatedAt: d.updatedAt.toISOString(),
          }))
        : undefined,
      servicesCatalog: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        price: money(s.price),
        isActive: s.isActive,
      })),
      kpis,
    };
  }

  private async computeOrgKpis(ctx: ToolCtx) {
    await this.plan.assertOrgAccess(ctx.userId, ctx.organizationId);

    const [
      totalClients,
      activeClients,
      openInvoices,
      overdueInvoices,
      overdueSum,
      quotesDraftOrSent,
      actsDraftOrSent,
    ] = await Promise.all([
      this.prisma.client.count({
        where: { organizationId: ctx.organizationId },
      }),
      this.prisma.client.count({
        where: {
          organizationId: ctx.organizationId,
          crmStatus: 'ACTIVE' as ClientCrmStatus,
        },
      }),
      this.prisma.invoice.count({
        where: {
          organizationId: ctx.organizationId,
          status: { in: ['DRAFT', 'SENT', 'OVERDUE'] as InvoiceStatus[] },
        },
      }),
      this.prisma.invoice.count({
        where: {
          organizationId: ctx.organizationId,
          status: 'OVERDUE' as InvoiceStatus,
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          organizationId: ctx.organizationId,
          status: 'OVERDUE' as InvoiceStatus,
        },
        _sum: { total: true },
      }),
      this.prisma.quote.count({
        where: {
          organizationId: ctx.organizationId,
          status: { in: ['DRAFT', 'SENT'] as QuoteStatus[] },
        },
      }),
      this.prisma.act.count({
        where: {
          organizationId: ctx.organizationId,
          status: { in: ['DRAFT', 'SENT'] as ActStatus[] },
        },
      }),
    ]);

    return {
      totalClients,
      activeClients,
      openInvoices,
      overdueInvoices,
      overdueTotal: money(overdueSum._sum.total),
      quotesDraftOrSent,
      actsDraftOrSent,
    };
  }

  // =========================
  // ✅ TOOLS DEFINITIONS
  // =========================

  private tools(): OpenAI.Chat.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'list_clients',
          description:
            'List clients in this organization (sanitized). Use for CRM queries, segmentation, and summaries.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search by name or tag (optional)',
              },
              status: {
                type: 'string',
                enum: ['LEAD', 'IN_PROGRESS', 'ACTIVE', 'INACTIVE'],
              },
              limit: { type: 'number', default: 20, minimum: 1, maximum: 50 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_client_summary',
          description:
            'Get a single client summary with aggregates (sanitized). Mask contacts unless explicitly requested.',
          parameters: {
            type: 'object',
            properties: {
              clientId: { type: 'string' },
              includeContacts: {
                type: 'boolean',
                description:
                  'Only true if user explicitly asked for email/phone. Returned masked.',
              },
            },
            required: ['clientId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_invoices',
          description: 'List invoices for org (sanitized) with filters.',
          parameters: {
            type: 'object',
            properties: {
              clientId: { type: 'string' },
              status: {
                type: 'string',
                enum: ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'],
              },
              from: { type: 'string', description: 'ISO date (optional)' },
              to: { type: 'string', description: 'ISO date (optional)' },
              limit: { type: 'number', default: 20, minimum: 1, maximum: 50 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_invoice_details',
          description: 'Get invoice with items (sanitized).',
          parameters: {
            type: 'object',
            properties: {
              invoiceId: { type: 'string' },
            },
            required: ['invoiceId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_activity_timeline',
          description:
            'Get recent activity for an entity (invoice/quote/act) or org. Emails masked.',
          parameters: {
            type: 'object',
            properties: {
              entityType: { type: 'string', enum: ['INVOICE', 'ACT', 'QUOTE'] },
              entityId: { type: 'string' },
              limit: { type: 'number', default: 30, minimum: 1, maximum: 100 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_todos',
          description:
            'List todo tasks for user. Optionally only for this org.',
          parameters: {
            type: 'object',
            properties: {
              onlyOrg: { type: 'boolean', default: false },
              status: {
                type: 'string',
                enum: ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'],
              },
              from: { type: 'string', description: 'ISO date (optional)' },
              to: { type: 'string', description: 'ISO date (optional)' },
              limit: { type: 'number', default: 30, minimum: 1, maximum: 100 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_services_catalog',
          description: 'Get active services/pricing list for proposals.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
  }

  private async runTool(ctx: ToolCtx, name: string, args: any) {
    await this.plan.assertOrgAccess(ctx.userId, ctx.organizationId);

    switch (name) {
      case 'list_clients': {
        const limit = Math.min(Math.max(Number(args?.limit ?? 20), 1), 50);
        const status = args?.status as ClientCrmStatus | undefined;
        const query = String(args?.query ?? '').trim();

        const clients = await this.prisma.client.findMany({
          where: {
            organizationId: ctx.organizationId,
            ...(status ? { crmStatus: status } : {}),
            ...(query
              ? {
                  OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { tags: { has: query } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
          select: {
            id: true,
            name: true,
            crmStatus: true,
            tags: true,
            notes: true,
            updatedAt: true,
          },
        });

        return clients.map((c) => ({
          id: c.id,
          name: c.name,
          crmStatus: c.crmStatus,
          tags: c.tags,
          notes: c.notes ?? null,
          updatedAt: c.updatedAt.toISOString(),
        }));
      }

      case 'get_client_summary': {
        const clientId = String(args?.clientId ?? '');
        const includeContacts = Boolean(args?.includeContacts);

        const client = await this.prisma.client.findFirst({
          where: { id: clientId, organizationId: ctx.organizationId },
          select: {
            id: true,
            name: true,
            crmStatus: true,
            tags: true,
            notes: true,
            email: true,
            phone: true,
            createdAt: true,
            updatedAt: true,
            invoices: {
              select: {
                status: true,
                total: true,
                issueDate: true,
                dueDate: true,
                paidAt: true,
              },
            },
          },
        });

        if (!client) throw new ForbiddenException('Client not found');

        const totals = client.invoices.reduce(
          (acc, inv) => {
            const total = Number(
              // @ts-ignore
              typeof inv.total?.toNumber === 'function'
                ? inv.total.toNumber()
                : inv.total,
            );
            acc.count += 1;
            acc.sum += isNaN(total) ? 0 : total;
            if (inv.status === 'OVERDUE')
              acc.overdue += isNaN(total) ? 0 : total;
            return acc;
          },
          { count: 0, sum: 0, overdue: 0 },
        );

        return {
          id: client.id,
          name: client.name,
          crmStatus: client.crmStatus,
          tags: client.tags,
          notes: client.notes ?? null,
          stats: {
            invoicesCount: totals.count,
            invoicesTotal: totals.sum.toFixed(2),
            overdueTotal: totals.overdue.toFixed(2),
          },
          contacts: includeContacts
            ? {
                email: maskEmail(client.email),
                phone: maskPhone(client.phone),
              }
            : undefined,
          updatedAt: client.updatedAt.toISOString(),
        };
      }

      case 'list_invoices': {
        const limit = Math.min(Math.max(Number(args?.limit ?? 20), 1), 50);
        const clientId = args?.clientId ? String(args.clientId) : undefined;
        const status = args?.status as InvoiceStatus | undefined;

        const from = args?.from ? new Date(String(args.from)) : undefined;
        const to = args?.to ? new Date(String(args.to)) : undefined;

        const invoices = await this.prisma.invoice.findMany({
          where: {
            organizationId: ctx.organizationId,
            ...(clientId ? { clientId } : {}),
            ...(status ? { status } : {}),
            ...(from || to
              ? {
                  issueDate: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                }
              : {}),
          },
          orderBy: { issueDate: 'desc' },
          take: limit,
          select: {
            id: true,
            number: true,
            issueDate: true,
            dueDate: true,
            currency: true,
            status: true,
            total: true,
            sentAt: true,
            paidAt: true,
            client: { select: { id: true, name: true } },
          },
        });

        return invoices.map((i) => ({
          id: i.id,
          number: i.number,
          issueDate: i.issueDate.toISOString(),
          dueDate: i.dueDate?.toISOString() ?? null,
          currency: i.currency,
          status: i.status,
          total: money(i.total),
          sentAt: i.sentAt?.toISOString() ?? null,
          paidAt: i.paidAt?.toISOString() ?? null,
          client: i.client ? { id: i.client.id, name: i.client.name } : null,
        }));
      }

      case 'get_invoice_details': {
        const invoiceId = String(args?.invoiceId ?? '');
        const inv = await this.prisma.invoice.findFirst({
          where: { id: invoiceId, organizationId: ctx.organizationId },
          select: {
            id: true,
            number: true,
            issueDate: true,
            dueDate: true,
            currency: true,
            status: true,
            subtotal: true,
            taxAmount: true,
            total: true,
            notes: true,
            sentAt: true,
            paidAt: true,
            client: { select: { id: true, name: true } },
            items: {
              select: {
                id: true,
                name: true,
                description: true,
                quantity: true,
                unitPrice: true,
                taxRate: true,
                lineTotal: true,
              },
            },
          },
        });

        if (!inv) throw new ForbiddenException('Invoice not found');

        return {
          id: inv.id,
          number: inv.number,
          issueDate: inv.issueDate.toISOString(),
          dueDate: inv.dueDate?.toISOString() ?? null,
          currency: inv.currency,
          status: inv.status,
          subtotal: money(inv.subtotal),
          taxAmount: money(inv.taxAmount),
          total: money(inv.total),
          notes: inv.notes ?? null,
          sentAt: inv.sentAt?.toISOString() ?? null,
          paidAt: inv.paidAt?.toISOString() ?? null,
          client: inv.client
            ? { id: inv.client.id, name: inv.client.name }
            : null,
          items: inv.items.map((it) => ({
            id: it.id,
            name: it.name,
            description: it.description ?? null,
            quantity: it.quantity,
            unitPrice: money(it.unitPrice),
            taxRate: it.taxRate != null ? money(it.taxRate) : null,
            lineTotal: money(it.lineTotal),
          })),
        };
      }

      case 'get_activity_timeline': {
        const limit = Math.min(Math.max(Number(args?.limit ?? 30), 1), 100);
        const entityType = args?.entityType as
          | 'INVOICE'
          | 'ACT'
          | 'QUOTE'
          | undefined;
        const entityId = args?.entityId ? String(args.entityId) : undefined;

        const logs = await this.prisma.activityLog.findMany({
          where: {
            organizationId: ctx.organizationId,
            ...(entityType ? { entityType } : {}),
            ...(entityId ? { entityId } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            entityType: true,
            entityId: true,
            eventType: true,
            fromStatus: true,
            toStatus: true,
            toEmail: true,
            meta: true,
            createdAt: true,
            actor: { select: { id: true, fullName: true, firstName: true } },
          },
        });

        return logs.map((l) => ({
          id: l.id,
          entityType: l.entityType,
          entityId: l.entityId,
          eventType: l.eventType,
          fromStatus: l.fromStatus ?? null,
          toStatus: l.toStatus ?? null,
          toEmail: l.toEmail ? maskEmail(l.toEmail) : null,
          meta: l.meta ?? null,
          createdAt: l.createdAt.toISOString(),
          actor: l.actor
            ? {
                id: l.actor.id,
                name: l.actor.fullName ?? l.actor.firstName ?? 'User',
              }
            : null,
        }));
      }

      case 'list_todos': {
        const limit = Math.min(Math.max(Number(args?.limit ?? 30), 1), 100);
        const onlyOrg = Boolean(args?.onlyOrg);
        const status = args?.status;
        const from = args?.from ? new Date(String(args.from)) : undefined;
        const to = args?.to ? new Date(String(args.to)) : undefined;

        const todos = await this.prisma.todoTask.findMany({
          where: {
            userId: ctx.userId,
            ...(onlyOrg ? { organizationId: ctx.organizationId } : {}),
            ...(status ? { status } : {}),
            ...(from || to
              ? {
                  startAt: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                }
              : {}),
          },
          orderBy: { startAt: 'asc' },
          take: limit,
          select: {
            id: true,
            title: true,
            description: true,
            startAt: true,
            endAt: true,
            status: true,
            priority: true,
            isPinned: true,
            organizationId: true,
          },
        });

        return todos.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description ?? null,
          startAt: t.startAt.toISOString(),
          endAt: t.endAt?.toISOString() ?? null,
          status: t.status,
          priority: t.priority,
          isPinned: t.isPinned,
          organizationId: t.organizationId ?? null,
        }));
      }

      case 'get_services_catalog': {
        const services = await this.prisma.userService.findMany({
          where: { userId: ctx.userId, isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, name: true, description: true, price: true },
        });

        return services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          price: money(s.price),
        }));
      }

      default:
        throw new InternalServerErrorException(`Unknown tool: ${name}`);
    }
  }

  // =========================
  // ✅ CHAT WITH TOOLS LOOP
  // =========================

  async generateBusinessReply(params: {
    ctx: ToolCtx;
    businessContext: string;
    knowledgeSnippets: KnowledgeSnippet[];
    messages: ChatMessageInput[];
    allowDocuments: boolean;
    safeContext?: AiSafeContext;
    maxToolRounds?: number;
  }): Promise<string> {
    const { ctx, businessContext, messages } = params;
    const allowDocuments = Boolean(params.allowDocuments);
    const maxToolRounds = Math.min(Math.max(params.maxToolRounds ?? 2, 0), 5);

    const safeContext =
      params.safeContext ??
      (await this.buildSafeContext({
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        allowDocuments,
      }));

    const docsPolicy = allowDocuments
      ? `Документи доступні: використовуй релевантні фрагменти, але не вигадуй того чого нема.`
      : `Документи НЕ доступні (користувач вимкнув доступ). Не посилайся на документи і не пропонуй "пошукати в документах".`;

    const systemPrompt = `
Ти — персональний AI-асистент для бізнесу.

Правила безпеки:
- НІКОЛИ не проси і не вигадуй платіжні реквізити (IBAN/SWIFT/ЄДРПОУ/ІПН/банки) — їх немає в доступі.
- Контактні дані клієнтів (email/phone) використовуй ТІЛЬКИ якщо користувач прямо попросив. Якщо бачиш email/phone — показуй масковано.
- Працюй лише в межах цієї організації. Якщо не вистачає даних — викликай tools.

${docsPolicy}

Твоя задача:
- відповідати від імені цього бізнесу,
- дотримуватись його тону, стилю та правил,
- якщо немає даних — чесно скажи що потрібно уточнити і запропонуй наступний крок.

БІЗНЕС-КОНТЕКСТ:
${businessContext || '(немає окремого профілю, поводься нейтрально та професійно)'}
`.trim();

    const kbText =
      allowDocuments && params.knowledgeSnippets.length
        ? params.knowledgeSnippets
            .map((s, i) => `[${i + 1}] Source: ${s.source}\n${s.content}`)
            .join('\n\n')
        : allowDocuments
          ? 'Немає релевантних фрагментів. Якщо питання про документи — попроси уточнення.'
          : 'Документи вимкнені для цього діалогу.';

    const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: `AI_SAFE_CONTEXT:\n${safeJson(safeContext)}` },
      { role: 'system', content: `РЕЛЕВАНТНІ ФРАГМЕНТИ:\n${kbText}` },
      ...messages,
    ];

    try {
      for (let round = 0; round <= maxToolRounds; round++) {
        const completion = await this.client.chat.completions.create({
          model: this.chatModel,
          messages: convo,
          tools: this.tools(),
          tool_choice: 'auto',
        });

        const msg = completion.choices[0]?.message;
        if (!msg)
          throw new InternalServerErrorException('AI returned empty message');

        const toolCalls = (msg as any).tool_calls as
          | Array<{
              id: string;
              type: 'function';
              function: { name: string; arguments: string };
            }>
          | undefined;

        if (!toolCalls?.length) {
          const content = msg.content ?? '';
          if (!content)
            throw new InternalServerErrorException(
              'AI returned empty response',
            );
          return content;
        }

        convo.push({
          role: 'assistant',
          content: msg.content ?? '',
          // @ts-ignore
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          const name = call.function.name;
          const args = call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
          const result = await this.runTool(ctx, name, args);

          convo.push({
            role: 'tool',
            // @ts-ignore
            tool_call_id: call.id,
            content: safeJson(result),
          });
        }
      }

      return 'Я зібрав дані, але не встиг сформувати відповідь. Спробуй запит коротше.';
    } catch (err) {
      console.error('AI error:', err);
      throw new InternalServerErrorException('Failed to generate AI reply');
    }
  }

  // =========================
  // EMBEDDINGS (як у тебе)
  // =========================

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout in ${label} after ${ms}ms`)),
        ms,
      );

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    const maxBatchSize = 20;
    const result: number[][] = [];

    for (let i = 0; i < texts.length; i += maxBatchSize) {
      const batch = texts.slice(i, i + maxBatchSize);

      try {
        const response = await this.withTimeout(
          this.client.embeddings.create({
            model: this.embeddingModel,
            input: batch,
          }),
          this.embeddingTimeoutMs,
          'createEmbeddings batch',
        );

        for (const item of response.data) result.push(item.embedding);
      } catch (err) {
        console.error('Error creating embeddings batch:', err);
        for (let j = 0; j < batch.length; j++) result.push([]);
      }
    }

    return result;
  }

  async embedQuery(query: string): Promise<number[] | null> {
    if (!query.trim()) return null;

    try {
      const response = await this.withTimeout(
        this.client.embeddings.create({
          model: this.embeddingModel,
          input: [query],
        }),
        this.embeddingTimeoutMs,
        'embedQuery',
      );

      const embedding = response.data[0]?.embedding as number[] | undefined;
      return embedding ?? null;
    } catch (err) {
      console.error('Error in embedQuery:', err);
      return null;
    }
  }
}
