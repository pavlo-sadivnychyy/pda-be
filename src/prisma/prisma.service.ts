import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, Prisma.LogLevel>
  implements OnModuleInit
{
  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ],
    });

    this.$on('error', (e) => console.log(e.message));
    this.$on('warn', (e) => console.log(e.message));
    this.$on('info', (e) => console.log(e.message));
    this.$on('query', (e) => {
      console.log(`[${e.duration} ms] ${e.query}; ${e.params}`);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
