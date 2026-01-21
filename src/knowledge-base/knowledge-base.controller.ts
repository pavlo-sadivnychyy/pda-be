import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
  UploadedFile,
  Res,
  UseGuards,
  Body,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { KnowledgeBaseService } from './knowledge-base.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

class UploadDocumentDto {
  organizationId: string;
  title?: string;
  description?: string;
  language?: string;
  tags?: string; // "tag1, tag2"
}

class CreateDocumentDto {
  organizationId: string;
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  description?: string;
  language?: string;
  tags?: string[];
}

function normalizeMulterFilename(name: string) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function encodeRFC5987(str: string) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
}

@UseGuards(ClerkAuthGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(
    private readonly kbService: KnowledgeBaseService,
    private readonly fileStorage: FileStorageService,
  ) {}

  // GET /knowledge-base/documents?organizationId=...
  @Get('documents')
  async listDocuments(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const docs = await this.kbService.listDocumentsForOrganization(
      req.authUserId,
      organizationId,
    );

    return { items: docs };
  }

  // GET /knowledge-base/documents/:id
  @Get('documents/:id')
  async getDocument(@Req() req: any, @Param('id') id: string) {
    const doc = await this.kbService.getDocumentById(req.authUserId, id);
    return { document: doc };
  }

  // ✅ Download: GET /knowledge-base/documents/:id/download
  @Get('documents/:id/download')
  async downloadDocument(
    @Req() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.kbService.getDocumentById(req.authUserId, id);

    if (!doc?.storageKey) {
      throw new BadRequestException('Document has no storageKey');
    }

    const { stream, contentType, contentLength } =
      await this.fileStorage.getFileStream(doc.storageKey);

    const original = doc.originalName || doc.title || 'document';
    const safeAsciiFallback = 'document';

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeAsciiFallback}"; filename*=UTF-8''${encodeRFC5987(
        original,
      )}`,
    );

    res.setHeader(
      'Content-Type',
      contentType || doc.mimeType || 'application/octet-stream',
    );

    if (typeof contentLength === 'number') {
      res.setHeader('Content-Length', String(contentLength));
    }

    stream.on('error', () => {
      if (!res.headersSent) res.status(500).send('Failed to download file');
      else res.end();
    });

    return stream.pipe(res);
  }

  // POST /knowledge-base/documents (JSON-only)
  @Post('documents')
  async createDocument(@Req() req: any, @Body() body: CreateDocumentDto) {
    if (!body.organizationId)
      throw new BadRequestException('organizationId is required');

    const doc = await this.kbService.createDocument(req.authUserId, {
      organizationId: body.organizationId,
      createdById: 'IGNORED', // ✅ ігнорується в сервісі
      title: body.title,
      originalName: body.originalName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      storageKey: body.storageKey,
      description: body.description,
      language: body.language,
      tags: body.tags ?? [],
    });

    return { document: doc };
  }

  // ✅ Upload: POST /knowledge-base/upload
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (!body.organizationId)
      throw new BadRequestException('organizationId is required');

    const tags: string[] = body.tags
      ? body.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const originalName = normalizeMulterFilename(file.originalname);

    // 1) upload to storage
    const storageKey = await this.fileStorage.uploadFile(
      { ...file, originalname: originalName } as any,
      { organizationId: body.organizationId },
    );

    // 2) create DB doc (createdById береться з токена)
    const doc = await this.kbService.createDocument(req.authUserId, {
      organizationId: body.organizationId,
      createdById: 'IGNORED',
      title: body.title || originalName,
      originalName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageKey,
      description: body.description,
      language: body.language,
      tags,
    });

    return { document: doc };
  }

  // GET /knowledge-base/search?organizationId=...&q=...&limit=10
  @Get('search')
  async search(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
  ) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');
    if (!q) throw new BadRequestException('q (query) is required');

    const limit = limitRaw ? Number(limitRaw) || 10 : 10;

    const items = await this.kbService.searchInOrganization(
      req.authUserId,
      organizationId,
      q,
      limit,
    );

    return { items };
  }

  // DELETE /knowledge-base/documents/:id
  @Delete('documents/:id')
  async deleteDocument(@Req() req: any, @Param('id') id: string) {
    const res = await this.kbService.deleteDocument(req.authUserId, id);
    return res;
  }
}
