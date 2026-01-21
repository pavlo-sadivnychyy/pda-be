import { Injectable, NotFoundException } from '@nestjs/common';
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
      },
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

    const userId = await this.plan.resolveDbUserId(authUserId);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Chat session not found');

    await this.plan.assertOrgAccess(userId, session.organizationId);

    // ✅ AI quota by plan (FREE 5/mo, BASIC 50/mo, PRO ∞)
    await this.plan.assertAiQuota(userId, session.organizationId);

    const userMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.USER,
        content,
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
      query: content,
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
        metadata: { knowledgeSources: knowledgeSnippets },
      },
    });

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    return { userMessage, assistantMessage, knowledgeSnippets };
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
      where: { document: { organizationId, status: 'READY' as any } },
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
