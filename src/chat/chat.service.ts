import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  ChatMessageRole,
  ChatSessionStatus,
  BusinessProfile,
  Organization,
  PlanId,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  // ✅ clerk authUserId -> db userId
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

  // ✅ plan/quota helpers
  private async getUserPlanId(dbUserId: string): Promise<PlanId> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId: dbUserId },
      select: { planId: true },
    });

    return (sub?.planId as PlanId) ?? PlanId.FREE;
  }

  private getAiMonthlyLimit(planId: PlanId): number {
    switch (planId) {
      case PlanId.FREE:
        return 5;
      case PlanId.BASIC:
        return 50;
      case PlanId.PRO:
        return Number.POSITIVE_INFINITY;
      default:
        return 5;
    }
  }

  private getMonthStartUtc(d = new Date()): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
  }

  private async assertAiQuota(dbUserId: string) {
    const planId = await this.getUserPlanId(dbUserId);
    const limit = this.getAiMonthlyLimit(planId);

    if (!Number.isFinite(limit)) return; // PRO

    const monthStart = this.getMonthStartUtc(new Date());

    // Рахуємо саме "AI replies", бо 1 user message => 1 AI call
    const used = await this.prisma.chatMessage.count({
      where: {
        role: ChatMessageRole.ASSISTANT,
        createdAt: { gte: monthStart },
        session: {
          createdById: dbUserId,
        },
      },
    });

    if (used >= limit) {
      throw new BadRequestException(
        `Ліміт AI-асистента для плану ${planId}: ${limit} запитів/місяць. Оновіть підписку, щоб зняти обмеження.`,
      );
    }
  }

  // --------- ORG ACCESS (owner-only) ---------

  private async ensureUserInOrganization(
    organizationId: string,
    userId: string,
  ) {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, ownerId: true },
    });

    if (!org) throw new NotFoundException('Organization not found');

    if (org.ownerId !== userId) {
      throw new ForbiddenException('No access to this organization');
    }
  }

  // --------- СЕСІЇ ---------

  async listSessionsForOrg(params: {
    organizationId: string;
    authUserId: string;
  }) {
    const { organizationId, authUserId } = params;

    const userId = await this.resolveDbUserId(authUserId);
    await this.ensureUserInOrganization(organizationId, userId);

    return this.prisma.chatSession.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async getSessionById(params: { id: string; authUserId: string }) {
    const { id, authUserId } = params;

    const userId = await this.resolveDbUserId(authUserId);

    const session = await this.prisma.chatSession.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    await this.ensureUserInOrganization(session.organizationId, userId);

    return session;
  }

  async createSession(params: {
    organizationId: string;
    authUserId: string;
    title?: string;
  }) {
    const { organizationId, authUserId, title } = params;

    const createdById = await this.resolveDbUserId(authUserId);
    await this.ensureUserInOrganization(organizationId, createdById);

    const safeTitle =
      (title || 'Новий діалог').trim().slice(0, 80) || 'Новий діалог';

    const session = await this.prisma.chatSession.create({
      data: {
        organizationId,
        createdById,
        title: safeTitle,
        status: ChatSessionStatus.ACTIVE,
      },
    });

    return session;
  }

  // ✅ DELETE session (+ messages) — hard delete
  async deleteSession(params: { sessionId: string; authUserId: string }) {
    const { sessionId, authUserId } = params;

    const userId = await this.resolveDbUserId(authUserId);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, organizationId: true },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    await this.ensureUserInOrganization(session.organizationId, userId);

    await this.prisma.$transaction([
      this.prisma.chatMessage.deleteMany({
        where: { sessionId: session.id },
      }),
      this.prisma.chatSession.delete({
        where: { id: session.id },
      }),
    ]);

    return { ok: true };
  }

  // --------- ПОВІДОМЛЕННЯ + RAG ---------

  async sendMessage(params: {
    sessionId: string;
    authUserId: string;
    content: string;
  }) {
    const { sessionId, authUserId, content } = params;

    const userId = await this.resolveDbUserId(authUserId);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    await this.ensureUserInOrganization(session.organizationId, userId);

    const cleanContent = (content || '').trim();
    if (!cleanContent) throw new BadRequestException('content is required');

    // ✅ Плановий ліміт (до AI виклику)
    await this.assertAiQuota(userId);

    const userMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.USER,
        content: cleanContent,
      },
    });

    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const aiMessages = history.map((m) => ({
      role:
        m.role === ChatMessageRole.USER
          ? ('user' as const)
          : ('assistant' as const),
      content: m.content,
    }));

    const businessProfile = await this.prisma.businessProfile.findUnique({
      where: { organizationId: session.organizationId },
    });

    const organization = await this.prisma.organization.findUnique({
      where: { id: session.organizationId },
    });

    const businessContext = businessProfile
      ? this.buildBusinessContext(businessProfile, organization)
      : '';

    const kbChunks = await this.findRelevantChunks({
      organizationId: session.organizationId,
      query: cleanContent,
      limit: 8,
    });

    const knowledgeSnippets = kbChunks.map((chunk) => ({
      content: chunk.content,
      source: `${chunk.document.title} (#${chunk.chunkIndex + 1})`,
    }));

    const assistantText = await this.ai.generateBusinessReply({
      businessContext,
      knowledgeSnippets,
      messages: aiMessages,
    });

    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.ASSISTANT,
        content: assistantText,
        metadata: {
          knowledgeSources: knowledgeSnippets,
        },
      },
    });

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    return {
      userMessage,
      assistantMessage,
      knowledgeSnippets,
    };
  }

  // --------- HELPERS ---------

  private buildBusinessContext(
    profile: BusinessProfile | null,
    org: Organization | null,
  ): string {
    const parts: string[] = [];

    if (org) {
      parts.push(`Назва організації: ${org.name}`);
      if (org.industry) parts.push(`Індустрія: ${org.industry}`);
      if (org.description) parts.push(`Опис: ${org.description}`);
      if ((org as any).businessNiche)
        parts.push(`Ніша: ${(org as any).businessNiche}`);
      if ((org as any).servicesDescription)
        parts.push(`Послуги: ${(org as any).servicesDescription}`);
      if ((org as any).targetAudience)
        parts.push(`Цільова аудиторія: ${(org as any).targetAudience}`);
      if ((org as any).brandStyle)
        parts.push(`Брендовий стиль: ${(org as any).brandStyle}`);
    }

    if (profile) {
      if (profile.tagline) parts.push(`Слоган: ${profile.tagline}`);
      if (profile.niche)
        parts.push(`Додаткова інформація про нішу: ${profile.niche}`);
      if (profile.longDescription)
        parts.push(`Розширений опис бізнесу: ${profile.longDescription}`);
      if ((profile as any).targetAudienceSummary) {
        parts.push(
          `Розширений опис цільової аудиторії: ${(profile as any).targetAudienceSummary}`,
        );
      }
    }

    return parts.join('\n');
  }

  private async findRelevantChunks(params: {
    organizationId: string;
    query: string;
    limit: number;
  }) {
    const { organizationId, query, limit } = params;

    const queryEmbedding = await this.ai.embedQuery(query);

    if (!queryEmbedding) {
      return this.prisma.documentChunk.findMany({
        where: {
          document: { organizationId, status: 'READY' as any },
          content: { contains: query, mode: 'insensitive' },
        },
        include: { document: true },
        take: limit,
      });
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        document: { organizationId, status: 'READY' as any },
      },
      include: { document: true },
      take: 1000,
    });

    if (!chunks.length) {
      return this.prisma.documentChunk.findMany({
        where: {
          document: { organizationId, status: 'READY' as any },
          content: { contains: query, mode: 'insensitive' },
        },
        include: { document: true },
        take: limit,
      });
    }

    const scored = chunks
      .map((chunk) => {
        const emb = chunk.embedding as unknown as number[];
        const score = this.cosineSimilarity(queryEmbedding, emb);
        return { chunk, score };
      })
      .filter((item) => item.score > -0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (!scored.length) {
      return this.prisma.documentChunk.findMany({
        where: {
          document: { organizationId, status: 'READY' as any },
          content: { contains: query, mode: 'insensitive' },
        },
        include: { document: true },
        take: limit,
      });
    }

    return scored.map((s) => s.chunk);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return -1;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (!normA || !normB) return -1;

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
