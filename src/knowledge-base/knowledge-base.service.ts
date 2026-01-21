import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Document, DocumentStatus, PlanId } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { AiService } from '../ai/ai.service';

import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
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

type KbLimits = {
  // max docs per org
  maxDocsPerOrg: number;
  // max file size bytes
  maxUploadBytes: number;
  // max chunks returned from search
  maxSearchLimit: number;
  // whether embeddings are allowed
  allowEmbeddings: boolean;
};

function parseIntSafe(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getPlanKbLimits(planId: PlanId): KbLimits {
  // ✅ один раз налаштовуєш в .env, без коду
  // KB_LIMITS_FREE='{"maxDocsPerOrg":5,"maxUploadBytes":5242880,"maxSearchLimit":10,"allowEmbeddings":false}'
  // KB_LIMITS_BASIC='{"maxDocsPerOrg":50,"maxUploadBytes":26214400,"maxSearchLimit":20,"allowEmbeddings":false}'
  // KB_LIMITS_PRO='{"maxDocsPerOrg":500,"maxUploadBytes":104857600,"maxSearchLimit":50,"allowEmbeddings":true}'
  const envKey =
    planId === PlanId.PRO
      ? 'KB_LIMITS_PRO'
      : planId === PlanId.BASIC
        ? 'KB_LIMITS_BASIC'
        : 'KB_LIMITS_FREE';

  let raw: any = null;
  try {
    raw = JSON.parse(process.env[envKey] || '');
  } catch {
    raw = null;
  }

  // ✅ дефолти, якщо env не заданий (робочі, але ти краще задай свої)
  const defaults: KbLimits =
    planId === PlanId.PRO
      ? {
          maxDocsPerOrg: 500,
          maxUploadBytes: 100 * 1024 * 1024,
          maxSearchLimit: 50,
          allowEmbeddings: true,
        }
      : planId === PlanId.BASIC
        ? {
            maxDocsPerOrg: 50,
            maxUploadBytes: 25 * 1024 * 1024,
            maxSearchLimit: 20,
            allowEmbeddings: false,
          }
        : {
            maxDocsPerOrg: 5,
            maxUploadBytes: 5 * 1024 * 1024,
            maxSearchLimit: 10,
            allowEmbeddings: false,
          };

  const merged = {
    ...defaults,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  return {
    maxDocsPerOrg: parseIntSafe(merged.maxDocsPerOrg, defaults.maxDocsPerOrg),
    maxUploadBytes: parseIntSafe(
      merged.maxUploadBytes,
      defaults.maxUploadBytes,
    ),
    maxSearchLimit: parseIntSafe(
      merged.maxSearchLimit,
      defaults.maxSearchLimit,
    ),
    allowEmbeddings: Boolean(merged.allowEmbeddings),
  };
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
    private readonly ai: AiService,
  ) {}

  // =========================
  // ✅ AUTH / OWNER / PLAN
  // =========================
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

  private async assertOwnerAccess(dbUserId: string, organizationId: string) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, ownerId: true },
    });

    if (!org) throw new BadRequestException('Organization not found');
    if (org.ownerId !== dbUserId) {
      throw new ForbiddenException('No access to this organization');
    }
  }

  private async getUserPlanId(dbUserId: string): Promise<PlanId> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId: dbUserId },
      select: { planId: true },
    });
    return (sub?.planId as PlanId) ?? PlanId.FREE;
  }

  private async getKbLimitsForAuthUser(authUserId: string): Promise<KbLimits> {
    const dbUserId = await this.resolveDbUserId(authUserId);
    const planId = await this.getUserPlanId(dbUserId);
    return getPlanKbLimits(planId);
  }

  private async assertUploadLimits(params: {
    organizationId: string;
    sizeBytes: number;
    limits: KbLimits;
  }) {
    const { organizationId, sizeBytes, limits } = params;

    if (sizeBytes > limits.maxUploadBytes) {
      throw new ForbiddenException(
        `Файл завеликий для вашого плану. Max: ${limits.maxUploadBytes} bytes.`,
      );
    }

    const docsCount = await this.prisma.document.count({
      where: { organizationId },
    });

    if (docsCount >= limits.maxDocsPerOrg) {
      throw new ForbiddenException(
        `Ліміт документів досягнуто для вашого плану. Max: ${limits.maxDocsPerOrg}.`,
      );
    }
  }

  // =========================
  // ✅ PUBLIC API (guarded by controller)
  // =========================

  async listDocumentsForOrganization(
    authUserId: string,
    organizationId: string,
  ) {
    const dbUserId = await this.resolveDbUserId(authUserId);
    await this.assertOwnerAccess(dbUserId, organizationId);

    return this.prisma.document.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentById(authUserId: string, id: string) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { chunks: true },
    });

    if (!doc) throw new NotFoundException('Document not found');

    await this.assertOwnerAccess(dbUserId, doc.organizationId);

    return doc;
  }

  async createDocument(authUserId: string, input: CreateDocumentInput) {
    const dbUserId = await this.resolveDbUserId(authUserId);
    await this.assertOwnerAccess(dbUserId, input.organizationId);

    const limits = await this.getKbLimitsForAuthUser(authUserId);
    await this.assertUploadLimits({
      organizationId: input.organizationId,
      sizeBytes: input.sizeBytes,
      limits,
    });

    const doc = await this.prisma.document.create({
      data: {
        organizationId: input.organizationId,
        createdById: dbUserId, // ✅ тільки з токена
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

    // ✅ обробка асинхронно як було
    this.processDocumentFile(doc, limits).catch((err) =>
      console.error('[KB] processDocumentFile error', doc.id, err),
    );

    return doc;
  }

  async deleteDocument(authUserId: string, id: string) {
    const dbUserId = await this.resolveDbUserId(authUserId);

    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true, organizationId: true, storageKey: true },
    });

    if (!doc) throw new NotFoundException('Document not found');

    await this.assertOwnerAccess(dbUserId, doc.organizationId);

    await this.prisma.documentChunk.deleteMany({ where: { documentId: id } });
    await this.prisma.document.delete({ where: { id } });

    // (опціонально) видалити файл зі сховища, якщо треба:
    // if (doc.storageKey) await this.fileStorage.deleteFile(doc.storageKey);

    return { success: true };
  }

  async searchInOrganization(
    authUserId: string,
    organizationId: string,
    query: string,
    limit = 10,
  ) {
    const dbUserId = await this.resolveDbUserId(authUserId);
    await this.assertOwnerAccess(dbUserId, organizationId);

    const limits = await this.getKbLimitsForAuthUser(authUserId);

    if (!query.trim()) return [];

    const take = Math.min(Math.max(limit, 1), limits.maxSearchLimit);

    return this.prisma.documentChunk.findMany({
      where: {
        document: { organizationId },
        content: { contains: query, mode: 'insensitive' },
      },
      include: { document: true },
      take,
      orderBy: { createdAt: 'desc' },
    });
  }

  // =========================
  // ✅ PROCESSING
  // =========================
  private async processDocumentFile(doc: Document, limits: KbLimits) {
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
      if (limits.allowEmbeddings && chunks.length) {
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

    if (mt.includes('pdf') || name.endsWith('.pdf')) {
      return extractPdfText(buffer);
    }

    if (mt.includes('word') || name.endsWith('.docx')) {
      const res = await mammoth.extractRawText({ buffer });
      return res.value || '';
    }

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
