import { Injectable, NotFoundException } from '@nestjs/common';
import { Document, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { AiService } from '../ai/ai.service';

type CreateDocumentInput = {
  organizationId: string;
  createdById: string;

  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;

  storageKey: string;
  description?: string | null;
  language?: string | null;
  tags?: string[];
};

@Injectable()
export class KnowledgeBaseService {
  private readonly enableEmbeddings: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
    private readonly ai: AiService,
  ) {
    this.enableEmbeddings =
      (process.env.KB_ENABLE_EMBEDDINGS || 'false').toLowerCase() === 'true';
    console.log('[KB] embeddings enabled:', this.enableEmbeddings);
  }

  // ---------- ПУБЛІЧНІ МЕТОДИ ДЛЯ CONTROLLER ----------

  async listDocumentsForOrganization(organizationId: string) {
    return this.prisma.document.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentById(id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { chunks: true },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    return doc;
  }

  /**
   * Створення документа + запуск обробки файлу (chunking + embeddings).
   * Викликається як з JSON endpoint, так і з upload endpoint.
   */
  async createDocument(input: CreateDocumentInput) {
    console.log('[KB] createDocument start', input.originalName);

    const doc = await this.prisma.document.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.createdById,
        title: input.title,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        description: input.description ?? null,
        language: input.language ?? null,
        tags: input.tags ?? [],
        status: DocumentStatus.PROCESSING,
      },
    });

    console.log('[KB] created doc', doc.id);

    this.processDocumentFile(doc)
      .then(() => {
        console.log('[KB] processDocumentFile finished', doc.id);
      })
      .catch((err) => {
        console.error('[KB] processDocumentFile error', doc.id, err);
      });

    console.log('[KB] createDocument return', doc.id);

    return doc;
  }

  async deleteDocument(id: string) {
    await this.prisma.documentChunk.deleteMany({
      where: { documentId: id },
    });

    await this.prisma.document.delete({
      where: { id },
    });

    return { success: true };
  }

  /**
   * Пошук по базі знань (fallback варіант, якщо не хочеш RAG у чаті).
   */
  async searchInOrganization(
    organizationId: string,
    query: string,
    limit = 10,
  ) {
    if (!query.trim()) {
      return [];
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        document: { organizationId },
        content: {
          contains: query,
          mode: 'insensitive',
        },
      },
      include: {
        document: true,
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return chunks;
  }

  // ---------- ВНУТРІШНЯ ОБРОБКА ФАЙЛУ (chunking + embeddings) ----------

  private async processDocumentFile(doc: Document) {
    console.log('[KB] processDocumentFile START', doc.id, doc.originalName);

    try {
      // 1) читаємо файл з S3
      const buffer = await this.fileStorage.getFile(doc.storageKey);
      let text = buffer.toString('utf-8');

      text = text.trim();
      console.log('[KB] processDocumentFile text length', text.length);

      if (!text) {
        await this.markDocumentFailed(doc.id, 'Empty content');
        return;
      }

      // 2) ріжемо на чанки ~1000 символів
      const chunks = this.splitTextIntoChunks(text, 1000);
      console.log('[KB] processDocumentFile chunks count', chunks.length);

      // 3) генеруємо embeddings (якщо увімкнено)
      let embeddings: number[][] = [];
      if (this.enableEmbeddings && chunks.length > 0) {
        try {
          console.log('[KB] creating embeddings for', chunks.length, 'chunks');
          embeddings = await this.ai.createEmbeddings(chunks);
          console.log('[KB] embeddings created, count', embeddings.length);
        } catch (err) {
          console.error(
            `Failed to create embeddings for document ${doc.id}`,
            err,
          );
          embeddings = [];
        }
      }

      // 4) записуємо чанки + оновлюємо документ в одній транзакції
      await this.prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({
          where: { documentId: doc.id },
        });

        const createData = chunks.map((chunk, index) => ({
          documentId: doc.id,
          chunkIndex: index,
          content: chunk,
          tokenCount: this.estimateTokenCount(chunk),
          embedding:
            embeddings[index] && embeddings[index].length
              ? (embeddings[index] as unknown as number[])
              : [],
        }));

        if (createData.length > 0) {
          await tx.documentChunk.createMany({
            data: createData,
          });
        }

        await tx.document.update({
          where: { id: doc.id },
          data: {
            status: DocumentStatus.READY,
            chunkCount: createData.length,
          },
        });
      });

      console.log('[KB] processDocumentFile DONE tx', doc.id);
    } catch (err) {
      console.error('[KB] Error processing document file', doc.id, err);
      await this.markDocumentFailed(doc.id, 'Processing error');
    }
  }

  private async markDocumentFailed(id: string, reason: string) {
    console.log('[KB] markDocumentFailed', id, reason);

    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { description: true },
    });

    const prev = doc?.description ?? '';
    const suffix = `[KB ERROR: ${reason}]`;

    await this.prisma.document.update({
      where: { id },
      data: {
        status: DocumentStatus.FAILED,
        description: prev ? `${prev} ${suffix}` : suffix,
      },
    });
  }

  private splitTextIntoChunks(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    const len = text.length;
    let current = 0;

    while (current < len) {
      // Початково беремо шматок фіксованого розміру
      let next = Math.min(len, current + chunkSize);
      const slice = text.slice(current, next);

      // Шукаємо "гарне" місце для розрізу всередині slice
      let cut =
        slice.lastIndexOf('. ') !== -1
          ? slice.lastIndexOf('. ')
          : slice.lastIndexOf('\n') !== -1
            ? slice.lastIndexOf('\n')
            : slice.lastIndexOf(' ');

      // Якщо нічого не знайшли або cut занадто близько до початку —
      // просто ріжемо по chunkSize (щоб не зациклитись)
      if (cut <= 0) {
        cut = slice.length;
      }

      next = current + cut;
      if (next <= current) {
        // страховка від будь-яких дивних кейсів
        next = Math.min(len, current + chunkSize);
      }

      const piece = text.slice(current, next).trim();
      if (piece) {
        chunks.push(piece);
      }

      current = next;
    }

    return chunks;
  }

  private estimateTokenCount(text: string): number {
    // дуже груба оцінка: слова ≈ токени
    return text.split(/\s+/).filter(Boolean).length;
  }
}
