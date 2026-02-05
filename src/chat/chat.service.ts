import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ChatMessageRole,
  ChatSessionStatus,
  BusinessProfile,
  Organization,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { PlanService } from '../plan/plan.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly plan: PlanService,
  ) {}

  // --------- СЕСІЇ ---------

  async listSessionsForOrg(params: {
    organizationId: string;
    authUserId: string;
  }) {
    const { organizationId, authUserId } = params;

    const userId = await this.plan.resolveDbUserId(authUserId);
    await this.plan.assertOrgAccess(userId, organizationId);

    return this.prisma.chatSession.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async getSessionById(params: { id: string; authUserId: string }) {
    const { id, authUserId } = params;

    const userId = await this.plan.resolveDbUserId(authUserId);

    const session = await this.prisma.chatSession.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!session) throw new NotFoundException('Chat session not found');

    await this.plan.assertOrgAccess(userId, session.organizationId);

    return session;
  }

  async createSession(params: {
    organizationId: string;
    authUserId: string;
    title?: string;
    allowKnowledgeBase?: boolean;
  }) {
    const { organizationId, authUserId, title } = params;

    const createdById = await this.plan.resolveDbUserId(authUserId);
    await this.plan.assertOrgAccess(createdById, organizationId);

    return this.prisma.chatSession.create({
      data: {
        organizationId,
        createdById,
        title: title || 'Новий діалог',
        status: ChatSessionStatus.ACTIVE,
        allowKnowledgeBase: params.allowKnowledgeBase ?? true,
      },
    });
  }

  async setSessionKnowledgeAccess(params: {
    sessionId: string;
    authUserId: string;
    allowKnowledgeBase: boolean;
  }) {
    const userId = await this.plan.resolveDbUserId(params.authUserId);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: params.sessionId },
      select: { id: true, organizationId: true },
    });

    if (!session) throw new NotFoundException('Chat session not found');

    await this.plan.assertOrgAccess(userId, session.organizationId);

    return this.prisma.chatSession.update({
      where: { id: session.id },
      data: { allowKnowledgeBase: Boolean(params.allowKnowledgeBase) },
    });
  }

  async deleteSession(params: { sessionId: string; authUserId: string }) {
    const { sessionId, authUserId } = params;

    const userId = await this.plan.resolveDbUserId(authUserId);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, organizationId: true },
    });

    if (!session) throw new NotFoundException('Chat session not found');

    await this.plan.assertOrgAccess(userId, session.organizationId);

    await this.prisma.$transaction([
      this.prisma.chatMessage.deleteMany({ where: { sessionId: session.id } }),
      this.prisma.chatSession.delete({ where: { id: session.id } }),
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

    try {
      const userId = await this.plan.resolveDbUserId(authUserId);

      const session = await this.prisma.chatSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          organizationId: true,
          allowKnowledgeBase: true,
        },
      });

      if (!session) throw new NotFoundException('Chat session not found');

      await this.plan.assertOrgAccess(userId, session.organizationId);

      // ✅ AI quota by plan (FREE 5/mo, BASIC 50/mo, PRO ∞)
      await this.plan.assertAiQuota(userId, session.organizationId);

      // Створюємо повідомлення користувача
      const userMessage = await this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: ChatMessageRole.USER,
          content,
        },
      });

      // Отримуємо історію
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
        content: m.content || '', // ✅ FIX: fallback для null
      }));

      // ✅ FIX: Паралельне завантаження даних
      const [businessProfile, organization] = await Promise.all([
        this.prisma.businessProfile.findUnique({
          where: { organizationId: session.organizationId },
        }),
        this.prisma.organization.findUnique({
          where: { id: session.organizationId },
        }),
      ]);

      const businessContext = this.buildBusinessContext(
        businessProfile,
        organization,
      );

      // RAG - only if allowed by session
      let knowledgeSnippets: { content: string; source: string }[] = [];

      if (session.allowKnowledgeBase) {
        try {
          const kbChunks = await this.findRelevantChunks({
            organizationId: session.organizationId,
            query: content,
            limit: 8,
          });

          knowledgeSnippets = kbChunks.map((chunk) => ({
            content: chunk.content || '', // ✅ FIX: fallback
            source: `${chunk.document?.title || 'Unknown'} (#${chunk.chunkIndex + 1})`,
          }));
        } catch (error) {
          console.error('RAG error:', error);
          // ✅ FIX: продовжуємо без RAG якщо помилка
        }
      }

      // ✅ FIX: AI виклик з обробкою помилок
      let assistantText: string;
      try {
        assistantText = await this.ai.generateBusinessReply({
          ctx: { userId, organizationId: session.organizationId },
          businessContext,
          knowledgeSnippets,
          messages: aiMessages,
          allowDocuments: session.allowKnowledgeBase,
        });
      } catch (error) {
        console.error('AI generation error:', error);
        throw new BadRequestException('Failed to generate AI response');
      }

      // ✅ FIX: Перевірка на порожню відповідь
      if (!assistantText || !assistantText.trim()) {
        assistantText = 'Вибачте, не вдалося згенерувати відповідь.';
      }

      const assistantMessage = await this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: ChatMessageRole.ASSISTANT,
          content: assistantText,
          metadata: {
            knowledgeSources: knowledgeSnippets,
            allowKnowledgeBase: session.allowKnowledgeBase,
          },
        },
      });

      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });

      return { userMessage, assistantMessage, knowledgeSnippets };
    } catch (error) {
      // ✅ FIX: Логування для діагностики
      console.error('Chat sendMessage error:', error);
      throw error;
    }
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

    try {
      const queryEmbedding = await this.ai.embedQuery(query);

      // ✅ FIX: Якщо embedQuery фейлиться
      if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
        return this.fallbackSearch(organizationId, query, limit);
      }

      const chunks = await this.prisma.documentChunk.findMany({
        where: { document: { organizationId, status: 'READY' as any } },
        include: { document: true },
        take: 1000,
      });

      if (!chunks.length) {
        return [];
      }

      // ✅ FIX: Type-safe scoring
      const scored = chunks
        .map((chunk) => {
          // ✅ FIX: Перевірка на валідність embedding
          const emb = chunk.embedding as unknown as number[];
          if (!Array.isArray(emb) || emb.length === 0) {
            return null;
          }
          const score = this.cosineSimilarity(queryEmbedding, emb);
          return { chunk, score };
        })
        .filter(
          (item): item is { chunk: (typeof chunks)[0]; score: number } =>
            item !== null && item.score > -0.5,
        )
        .sort((a, b) => b.score - a.score) // ✅ FIX: тепер TypeScript знає що не null
        .slice(0, limit);

      if (!scored.length) {
        return this.fallbackSearch(organizationId, query, limit);
      }

      return scored.map((s) => s.chunk); // ✅ FIX: тепер TypeScript знає що не null
    } catch (error) {
      console.error('findRelevantChunks error:', error);
      return this.fallbackSearch(organizationId, query, limit);
    }
  }

  // ✅ NEW: Helper для fallback пошуку
  private async fallbackSearch(
    organizationId: string,
    query: string,
    limit: number,
  ) {
    try {
      return await this.prisma.documentChunk.findMany({
        where: {
          document: { organizationId, status: 'READY' as any },
          content: { contains: query, mode: 'insensitive' },
        },
        include: { document: true },
        take: limit,
      });
    } catch (error) {
      console.error('fallbackSearch error:', error);
      return [];
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || !a.length || !b.length || a.length !== b.length) return -1;

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
