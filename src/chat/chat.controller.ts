import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

class CreateSessionDto {
  organizationId: string;
  title?: string;

  // ✅ NEW: user controls docs access for this session
  allowKnowledgeBase?: boolean;
}

class SendMessageDto {
  content: string;
}

class SetKnowledgeAccessDto {
  allowKnowledgeBase: boolean;
}

@UseGuards(ClerkAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('sessions')
  async listSessions(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
  ) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const items = await this.chat.listSessionsForOrg({
      organizationId,
      authUserId: req.authUserId,
    });

    return { items };
  }

  @Get('sessions/:id')
  async getSession(@Req() req: any, @Param('id') id: string) {
    const session = await this.chat.getSessionById({
      id,
      authUserId: req.authUserId,
    });
    return { session };
  }

  @Post('sessions')
  async createSession(@Req() req: any, @Body() dto: CreateSessionDto) {
    if (!dto.organizationId)
      throw new BadRequestException('organizationId is required');

    const session = await this.chat.createSession({
      organizationId: dto.organizationId,
      authUserId: req.authUserId,
      title: dto.title,
      allowKnowledgeBase: dto.allowKnowledgeBase, // ✅ NEW
    });

    return { session };
  }

  // ✅ NEW: toggle docs access for a session
  @Post('sessions/:id/knowledge-access')
  async setKnowledgeAccess(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SetKnowledgeAccessDto,
  ) {
    if (typeof dto.allowKnowledgeBase !== 'boolean') {
      throw new BadRequestException('allowKnowledgeBase must be boolean');
    }

    const session = await this.chat.setSessionKnowledgeAccess({
      sessionId: id,
      authUserId: req.authUserId,
      allowKnowledgeBase: dto.allowKnowledgeBase,
    });

    return { session };
  }

  @Post('sessions/:id/messages')
  async sendMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    if (!dto.content || !dto.content.trim()) {
      throw new BadRequestException('content is required');
    }

    return this.chat.sendMessage({
      sessionId: id,
      authUserId: req.authUserId,
      content: dto.content,
    });
  }

  @Delete('sessions/:id')
  async deleteSession(@Req() req: any, @Param('id') id: string) {
    return this.chat.deleteSession({
      sessionId: id,
      authUserId: req.authUserId,
    });
  }
}
