import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as process from 'node:process';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    'http://localhost:3001', // локальний фронт (якщо використовуєш)
    'http://localhost:3000', // Next dev
    'https://pda-fe-dev-3883128e3ffd.herokuapp.com',
    'https://dev.spravly.com',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // дозволяємо запити без Origin (наприклад Postman, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(process.env.PORT || 3000);
}

bootstrap().catch((error) => console.log(error));
