import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import {
    ChatMessageRole,
    ChatSessionStatus,
    BusinessProfile,
    Organization,
    DocumentStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ChatService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly ai: AiService,
    ) {}

    // --------- СЕСІЇ ---------


    async listSessionsForOrg(organizationId: string, userId: string) {
        await this.ensureUserInOrganization(organizationId, userId);

        return this.prisma.chatSession.findMany({
            where: { organizationId },
            orderBy: { updatedAt: 'desc' },
            take: 50,
        });
    }

    async getSessionById(id: string, userId: string) {
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
        createdById: string;
        title?: string;
    }) {
        const { organizationId, createdById, title } = params;

        await this.ensureUserInOrganization(organizationId, createdById);

        const session = await this.prisma.chatSession.create({
            data: {
                organizationId,
                createdById,
                title: title || 'Новий діалог',
                status: ChatSessionStatus.ACTIVE,
            },
        });

        return session;
    }

    // --------- ПОВІДОМЛЕННЯ + RAG ---------

    async sendMessage(params: {
        sessionId: string;
        userId: string;
        content: string;
    }) {
        const { sessionId, userId, content } = params;

        const session = await this.prisma.chatSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            throw new NotFoundException('Chat session not found');
        }

        await this.ensureUserInOrganization(
          session.organizationId,
          userId,
        );

        // 1) зберігаємо user-повідомлення
        const userMessage = await this.prisma.chatMessage.create({
            data: {
                sessionId: session.id,
                role: ChatMessageRole.USER,
                content,
            },
        });

        // 2) історія останніх повідомлень
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

        // 3) Business profile
        const businessProfile =
          await this.prisma.businessProfile.findUnique({
              where: { organizationId: session.organizationId },
          });
        const organization = await this.prisma.organization.findUnique({
            where: { id: session.organizationId },
        });

        const businessContext = businessProfile
          ? this.buildBusinessContext(businessProfile, organization)
          : '';

        // 4) Пошук релевантних чанків у базі знань (embeddings + fallback)
        const kbChunks = await this.findRelevantChunks({
            organizationId: session.organizationId,
            query: content,
            limit: 8,
        });

        const knowledgeSnippets = kbChunks.map((chunk) => ({
            content: chunk.content,
            source: `${chunk.document.title} (#${chunk.chunkIndex + 1})`,
        }));

        // 5) Викликаємо AI
        const assistantText = await this.ai.generateBusinessReply({
            businessContext,
            knowledgeSnippets,
            messages: aiMessages,
        });

        // 6) Зберігаємо assistant-повідомлення
        const assistantMessage =
          await this.prisma.chatMessage.create({
              data: {
                  sessionId: session.id,
                  role: ChatMessageRole.ASSISTANT,
                  content: assistantText,
                  metadata: {
                      knowledgeSources: knowledgeSnippets,
                  },
              },
          });

        // 7) Оновлюємо updatedAt сесії
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

    private async ensureUserInOrganization(
        organizationId: string,
        userId: string,
    ) {
        const membership = await this.prisma.userOrganization.findFirst({
            where: {
                organizationId,
                userId,
            },
        });

        if (!membership) {
            throw new ForbiddenException(
                'User does not belong to this organization',
            );
        }
    }

    // Бізнес-контекст з Organization + BusinessProfile
    private buildBusinessContext(
        profile: BusinessProfile | null,
        org: Organization | null,
    ): string {
        const parts: string[] = [];

        if (org) {
            parts.push(`Назва організації: ${org.name}`);
            if (org.industry) parts.push(`Індустрія: ${org.industry}`);
            if (org.description) parts.push(`Опис: ${org.description}`);
            if (org.businessNiche) {
                parts.push(`Ніша: ${org.businessNiche}`);
            }
            if (org.servicesDescription) {
                parts.push(`Послуги: ${org.servicesDescription}`);
            }
            if (org.targetAudience) {
                parts.push(`Цільова аудиторія: ${org.targetAudience}`);
            }
            if (org.brandStyle) {
                parts.push(`Брендовий стиль: ${org.brandStyle}`);
            }
        }

        if (profile) {
            if (profile.tagline) {
                parts.push(`Слоган: ${profile.tagline}`);
            }
            if (profile.niche) {
                parts.push(`Додаткова інформація про нішу: ${profile.niche}`);
            }
            if (profile.longDescription) {
                parts.push(`Розширений опис бізнесу: ${profile.longDescription}`);
            }
            if (profile.targetAudienceSummary) {
                parts.push(
                    `Розширений опис цільової аудиторії: ${profile.targetAudienceSummary}`,
                );
            }
        }

        return parts.join('\n');
    }


    // --------- HELPERS ДЛЯ ПОШУКУ ЧАНКІВ ---------

    private async findRelevantChunks(params: {
        organizationId: string;
        query: string;
        limit: number;
    }) {
        const { organizationId, query, limit } = params;

        // 1) embedding для запиту
        const queryEmbedding = await this.ai.embedQuery(query);

        // Якщо embedding не вийшов — fallback на простий text search
        if (!queryEmbedding) {
            return this.prisma.documentChunk.findMany({
                where: {
                    document: {
                        organizationId,
                        status: ChatSessionStatus.ACTIVE ? undefined : undefined, // можна прибрати, якщо немає поля status у Document
                    },
                    content: {
                        contains: query,
                        mode: 'insensitive',
                    },
                },
                include: { document: true },
                take: limit,
            });
        }

        // 2) Беремо чанки з непорожніми embeddings
        const chunks = await this.prisma.documentChunk.findMany({
            where: {
                document: {
                    organizationId,
                    status: 'READY',
                },
            },
            include: { document: true },
            take: 1000,
        });

        if (!chunks.length) {
            // fallback, якщо embeddings ще ніде немає
            return this.prisma.documentChunk.findMany({
                where: {
                    document: {
                        organizationId,
                        status: 'READY',
                    },
                    content: {
                        contains: query,
                        mode: 'insensitive',
                    },
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
                    document: {
                        organizationId,
                        status: 'READY',
                    },
                    content: {
                        contains: query,
                        mode: 'insensitive',
                    },
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


    // // 🔍 RAG-пошук по embeddings + fallback на text contains
    // private async findRelevantChunksByEmbedding(params: {
    //     organizationId: string;
    //     query: string;
    //     limit: number;
    // }) {
    //     const { organizationId, query, limit } = params;
    //
    //     // 1) Пакетно тягнемо чанки для організації (MVP, потім можна замінити на pgvector)
    //     const chunks = await this.prisma.documentChunk.findMany({
    //         where: {
    //             document: {
    //                 organizationId,
    //                 status: DocumentStatus.READY,
    //             },
    //         },
    //         include: {
    //             document: true,
    //         },
    //         take: 500, // обмеження для памʼяті, можна налаштувати
    //     });
    //
    //     if (!chunks.length) return [];
    //
    //     // 2) Беремо тільки ті, де є embedding
    //     const chunksWithEmbedding = chunks.filter(
    //         (c) => Array.isArray(c.embedding) && c.embedding.length > 0,
    //     );
    //
    //     // Якщо ембеддингів ще нема — fallback на contains
    //     if (!chunksWithEmbedding.length) {
    //         return this.prisma.documentChunk.findMany({
    //             where: {
    //                 document: {
    //                     organizationId,
    //                 },
    //                 content: {
    //                     contains: query,
    //                     mode: 'insensitive',
    //                 },
    //             },
    //             include: {
    //                 document: true,
    //             },
    //             take: limit,
    //         });
    //     }
    //
    //     // 3) embedding для запиту
    //     const queryEmbedding = await this.ai.createEmbedding(query);
    //     if (!queryEmbedding.length) {
    //         return [];
    //     }
    //
    //     // 4) Cosine similarity по всіх чанках
    //     const scored = chunksWithEmbedding.map((chunk) => ({
    //         chunk,
    //         score: this.cosineSimilarity(
    //             queryEmbedding,
    //             chunk.embedding as number[],
    //         ),
    //     }));
    //
    //     scored.sort((a, b) => b.score - a.score);
    //
    //     return scored.slice(0, limit).map((s) => s.chunk);
    // }
}
