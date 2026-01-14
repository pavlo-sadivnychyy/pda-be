import { Injectable, InternalServerErrorException } from '@nestjs/common';
import OpenAI from 'openai';

type ChatMessageInput = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type KnowledgeSnippet = {
  content: string;
  source: string; // наприклад: "Document: Contract_v1.pdf"
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
    trialEnd?: string | null;
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
};

function safeJson(obj: unknown) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

@Injectable()
export class AiService {
  private client: OpenAI;
  private chatModel: string;
  private embeddingModel: string;
  private embeddingTimeoutMs: number;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    this.client = new OpenAI({ apiKey });
    this.chatModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // окремий модель для embeddings
    this.embeddingModel =
      process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-small';

    // таймаут для одного запиту embeddings, мс
    this.embeddingTimeoutMs = Number(
      process.env.OPENAI_EMBEDDING_TIMEOUT_MS ?? 20000,
    );
  }

  // --------- CHAT COMPLETIONS (як було) ---------

  async generateBusinessReply(params: {
    businessContext: string;
    knowledgeSnippets: KnowledgeSnippet[];
    messages: ChatMessageInput[];
    safeContext?: AiSafeContext; // ✅ додатковий safe контекст
  }): Promise<string> {
    const { businessContext, knowledgeSnippets, messages, safeContext } =
      params;

    const systemPrompt = `
Ти — персональний AI-асистент для бізнесу.

Твоя задача:
- відповідати від імені цього бізнесу,
- дотримуватись його тону, стилю та правил,
- опиратись на надані документи та фрагменти,
- якщо в документах немає відповіді — чесно скажи що не знайшов у наданих фрагментах, і запропонуй що уточнити або який документ пошукати.

БІЗНЕС-КОНТЕКСТ:
${businessContext || '(немає окремого профілю, поводься нейтрально та професійно)'}
`.trim();

    const kbText = knowledgeSnippets.length
      ? knowledgeSnippets
          .map((s, i) => `[${i + 1}] Source: ${s.source}\n${s.content}`)
          .join('\n\n')
      : 'Немає релевантних фрагментів. Якщо питання про документи — попроси уточнення або запропонуй перефразувати запит для пошуку.';

    const contextText = safeContext
      ? `AI_SAFE_CONTEXT (user/org/docs index/subscription):\n${safeJson(safeContext)}`
      : `AI_SAFE_CONTEXT: (немає додаткового контексту користувача/організації)`;

    const finalMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'system',
        content: contextText,
      },
      {
        role: 'system',
        content: `РЕЛЕВАНТНІ ФРАГМЕНТИ:\n${kbText}`,
      },
      ...messages,
    ];

    try {
      const completion = await this.client.chat.completions.create({
        model: this.chatModel,
        messages: finalMessages,
      });

      const content = completion.choices[0]?.message?.content ?? '';

      if (!content) {
        throw new InternalServerErrorException('AI returned empty response');
      }

      return content;
    } catch (err) {
      console.error('AI error:', err);
      throw new InternalServerErrorException('Failed to generate AI reply');
    }
  }

  // --------- EMBEDDINGS З ТАЙМАУТОМ ---------

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
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(err);
        });
    });
  }

  /**
   * Робить embeddings для масиву текстів (чанки документа).
   * Працює батчами, з таймаутом на кожен батч.
   */
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    const maxBatchSize = 20; // нормальний розмір батчу
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

        for (const item of response.data) {
          result.push(item.embedding);
        }
      } catch (err) {
        console.error('Error creating embeddings batch:', err);
        // якщо один батч впав — просто йдемо далі,
        // для решти чанків будуть порожні embeddings
        for (let j = 0; j < batch.length; j++) {
          result.push([]);
        }
      }
    }

    return result;
  }

  /**
   * Embedding для одного запиту (для пошуку по БД).
   */
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
