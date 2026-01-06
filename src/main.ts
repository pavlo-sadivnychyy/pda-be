import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // const app = await NestFactory.create(AppModule, {cors: true});
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'http://localhost:3001', // твій фронт
    credentials: true,
  });

  await app.listen(3000);
}
bootstrap().catch((error) => console.log(error));
