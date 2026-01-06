import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

@Injectable()
export class FileStorageService {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET_NAME!;
    if (!this.bucket) {
      throw new Error('S3_BUCKET_NAME is not set');
    }

    const region = process.env.S3_REGION || 'us-east-1';

    this.s3 = new S3Client({
      region,
      endpoint:
        region === 'us-east-1'
          ? 'https://s3.amazonaws.com'
          : `https://s3.${region}.amazonaws.com`,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }

  // Завантажити файл у S3 і повернути ключ
  async uploadFile(
    file: Express.Multer.File,
    options: {
      organizationId: string;
    },
  ): Promise<string> {
    const { organizationId } = options;

    const key = `orgs/${organizationId}/docs/${Date.now()}-${file.originalname}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer, // тобто файл в памʼяті
        ContentType: file.mimetype,
      }),
    );

    return key;
  }

  // Отримати файл із S3 як Buffer
  async getFile(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks);
  }
}
