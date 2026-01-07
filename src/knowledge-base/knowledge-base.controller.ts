import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { KnowledgeBaseService } from './knowledge-base.service';
import { FileStorageService } from '../file-storage/file-storage.service';

class CreateDocumentDto {
  organizationId: string;
  createdById: string;

  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;

  storageKey: string;
  description?: string;
  language?: string;
  tags?: string[];
}

class UploadDocumentDto {
  organizationId: string;
  createdById: string;

  title?: string;
  description?: string;
  language?: string;
  // tags прийдуть як строка "tag1, tag2"
  tags?: string;
}

@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(
    private readonly kbService: KnowledgeBaseService,
    private readonly fileStorage: FileStorageService,
  ) {}

  // GET /knowledge-base/documents?organizationId=...
  @Get('documents')
  async listDocuments(@Query('organizationId') organizationId?: string) {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const docs =
      await this.kbService.listDocumentsForOrganization(organizationId);

    return { items: docs };
  }

  // GET /knowledge-base/documents/:id
  @Get('documents/:id')
  async getDocument(@Param('id') id: string) {
    const doc = await this.kbService.getDocumentById(id);
    return { document: doc };
  }

  // POST /knowledge-base/documents (JSON-only, технічний)
  @Post('documents')
  async createDocument(@Body() body: CreateDocumentDto) {
    const doc = await this.kbService.createDocument({
      organizationId: body.organizationId,
      createdById: body.createdById,
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

  // ✅ Upload файлу + метадані через multipart/form-data
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!body.organizationId || !body.createdById) {
      throw new BadRequestException(
        'organizationId and createdById are required',
      );
    }

    const tags: string[] = body.tags
      ? body.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    // 1️⃣ Заливаємо файл у S3
    const storageKey = await this.fileStorage.uploadFile(file, {
      organizationId: body.organizationId,
    });

    // 2️⃣ Створюємо запис у БД з цим ключем
    const doc = await this.kbService.createDocument({
      organizationId: body.organizationId,
      createdById: body.createdById,
      title: body.title || file.originalname,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageKey, // 👈 тепер це ключ у S3
      description: body.description,
      language: body.language,
      tags,
    });

    return { document: doc };
  }

  // ✅ Пошук по базі знань
  // GET /knowledge-base/search?organizationId=...&q=...&limit=10
  @Get('search')
  async search(
    @Query('organizationId') organizationId?: string,
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
  ) {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!q) {
      throw new BadRequestException('q (query) is required');
    }

    const limit = limitRaw ? Number(limitRaw) || 10 : 10;

    const items = await this.kbService.searchInOrganization(
      organizationId,
      q,
      limit,
    );

    return { items };
  }

  // DELETE /knowledge-base/documents/:id
  @Delete('documents/:id')
  async deleteDocument(@Param('id') id: string) {
    const res = await this.kbService.deleteDocument(id);
    return res;
  }
}
