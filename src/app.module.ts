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
import { ActivityModule } from './activity/activity.module';
import { BillingModule } from './billing/billing.module';
import { ServicesModule } from './services/services.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RecurringInvoicesModule } from './recurring-invoices/recurring-invoices.module';

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
    ActivityModule,
    BillingModule,
    ServicesModule,
    RecurringInvoicesModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
