import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { ChatModule } from "./chat/chat.module";
import { ConfigModule } from '@nestjs/config';

@Module({
  // imports: [PrismaModule, UsersModule, OrganizationsModule, KnowledgeBaseModule, ChatModule, ConfigModule.forRoot({ isGlobal: true })],
  imports: [PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
