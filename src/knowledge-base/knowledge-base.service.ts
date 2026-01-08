import { Injectable, NotFoundException } from '@nestjs/common';
import { Document, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { AiService } from '../ai/ai.service';

import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// PDF.js – стабільний варіант
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

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

async function extractPdfText(buffer: Buffer): Promise<string> {
  const loadingTask = (pdfjs as any).getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  });

  const pdf = await loadingTask.promise;

  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const pageText = (content.items as any[])
      .map((it) => (typeof it?.str === 'string' ? it.str : ''))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText) pages.push(pageText);
  }

  return pages.join('\n\n');
}

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

  // ---------- PUBLIC ----------

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

  async createDocument(input: CreateDocumentInput) {
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

    this.processDocumentFile(doc).catch((err) =>
      console.error('[KB] processDocumentFile error', doc.id, err),
    );

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

  async searchInOrganization(
    organizationId: string,
    query: string,
    limit = 10,
  ) {
    if (!query.trim()) return [];

    return this.prisma.documentChunk.findMany({
      where: {
        document: { organizationId },
        content: { contains: query, mode: 'insensitive' },
      },
      include: { document: true },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------- PROCESSING ----------

  private async processDocumentFile(doc: Document) {
    try {
      const buffer = await this.fileStorage.getFile(doc.storageKey);

      const text = (
        await this.extractText(buffer, doc.mimeType, doc.originalName)
      ).trim();

      if (!text) {
        await this.markDocumentFailed(
          doc.id,
          'Empty content (PDF may be scan)',
        );
        return;
      }

      const chunks = this.splitTextIntoChunks(text, 1000);

      let embeddings: number[][] = [];
      if (this.enableEmbeddings && chunks.length) {
        try {
          embeddings = await this.ai.createEmbeddings(chunks);
        } catch {
          embeddings = [];
        }
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({
          where: { documentId: doc.id },
        });

        if (chunks.length) {
          await tx.documentChunk.createMany({
            data: chunks.map((chunk, i) => ({
              documentId: doc.id,
              chunkIndex: i,
              content: chunk,
              tokenCount: this.estimateTokenCount(chunk),
              embedding: embeddings[i] ?? [],
            })),
          });
        }

        await tx.document.update({
          where: { id: doc.id },
          data: {
            status: DocumentStatus.READY,
            chunkCount: chunks.length,
          },
        });
      });
    } catch (err: any) {
      await this.markDocumentFailed(
        doc.id,
        `Processing error: ${err?.message || 'unknown'}`,
      );
    }
  }

  private async extractText(
    buffer: Buffer,
    mimeType?: string | null,
    originalName?: string | null,
  ): Promise<string> {
    const mt = (mimeType || '').toLowerCase();
    const name = (originalName || '').toLowerCase();

    // PDF
    if (mt.includes('pdf') || name.endsWith('.pdf')) {
      return extractPdfText(buffer);
    }

    // DOCX
    if (mt.includes('word') || name.endsWith('.docx')) {
      const res = await mammoth.extractRawText({ buffer });
      return res.value || '';
    }

    // XLSX / XLS
    if (
      mt.includes('excel') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls')
    ) {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const parts: string[] = [];

      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
          header: 1,
        });

        for (const r of rows) {
          if (Array.isArray(r)) {
            const line = r.map(String).join(' ').trim();
            if (line) parts.push(line);
          }
        }
      }

      return parts.join('\n');
    }

    // TXT
    return buffer.toString('utf-8');
  }

  private async markDocumentFailed(id: string, reason: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { description: true },
    });

    await this.prisma.document.update({
      where: { id },
      data: {
        status: DocumentStatus.FAILED,
        description: doc?.description
          ? `${doc.description} [KB ERROR: ${reason}]`
          : `[KB ERROR: ${reason}]`,
      },
    });
  }

  private splitTextIntoChunks(text: string, size: number) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) {
      out.push(text.slice(i, i + size));
    }
    return out;
  }

  private estimateTokenCount(text: string) {
    return text.split(/\s+/).filter(Boolean).length;
  }
}
