import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as process from 'node:process';

async function bootstrap() {
  // ✅ required for webhook signature verification (raw body)
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const allowedOrigins = [
    'http://localhost:3001',
    'http://localhost:3000',
    'https://pda-fe-dev-3883128e3ffd.herokuapp.com',
    'https://dev.spravly.com',
    'https://spravly.com',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Paddle-Signature',
      'paddle-signature',
    ],
  });

  await app.listen(process.env.PORT || 3000);
}

bootstrap().catch((error) => console.log(error));
