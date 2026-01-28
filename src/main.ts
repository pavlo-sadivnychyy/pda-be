import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as process from 'node:process';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
      // ✅ Paddle webhook signature header (та інколи фронт теж може прокидати)
      'Paddle-Signature',
      'paddle-signature',
    ],
  });

  // ✅ важливо для Paddle: зберігаємо rawBody точно як прийшло
  app.use(
    bodyParser.json({
      limit: '2mb',
      verify: (req: any, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(
    bodyParser.urlencoded({
      extended: true,
      limit: '2mb',
      verify: (req: any, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  await app.listen(process.env.PORT || 3000);
}

bootstrap().catch((error) => console.log(error));
