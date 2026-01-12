import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { ChatModule } from './chat/chat.module';
import { ConfigModule } from '@nestjs/config';
import { TodoModule } from './todo/todo.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ClientsModule } from './clients/clients.module';
import { ActsModule } from './acts/acts.module';
import { QuotesModule } from './quotes/quotes.module';

@Module({
  imports: [
    PrismaModule,
    TodoModule,
    UsersModule,
    OrganizationsModule,
    KnowledgeBaseModule,
    ChatModule,
    ClientsModule,
    ActsModule,
    QuotesModule,
    InvoicesModule,
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
