import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ChatService } from './chat.service';

class CreateSessionDto {
  organizationId: string;
  createdById: string;
  title?: string;
}

class SendMessageDto {
  userId: string;
  content: string;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('sessions')
  async listSessions(
    @Query('organizationId') organizationId: string,
    @Query('userId') userId: string,
  ) {
    const items = await this.chat.listSessionsForOrg(organizationId, userId);
    return { items };
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string, @Query('userId') userId: string) {
    const session = await this.chat.getSessionById(id, userId);
    return { session };
  }

  @Post('sessions')
  async createSession(@Body() dto: CreateSessionDto) {
    const session = await this.chat.createSession(dto);
    return { session };
  }

  @Post('sessions/:id/messages')
  async sendMessage(@Param('id') id: string, @Body() dto: SendMessageDto) {
    const result = await this.chat.sendMessage({
      sessionId: id,
      userId: dto.userId,
      content: dto.content,
    });

    return result;
  }

  // ✅ DELETE /chat/sessions/:id?userId=...
  @Delete('sessions/:id')
  async deleteSession(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    return this.chat.deleteSession(id, userId);
  }
}
