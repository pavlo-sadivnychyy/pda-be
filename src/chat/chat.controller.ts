import {
    Body,
    Controller,
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
    userId: string;   // наш internal user.id
    content: string;
}

@Controller('chat')
export class ChatController {
    constructor(private readonly chat: ChatService) {}

    // GET /chat/sessions?organizationId=...&userId=...
    @Get('sessions')
    async listSessions(
        @Query('organizationId') organizationId: string,
        @Query('userId') userId: string,
    ) {
        const items = await this.chat.listSessionsForOrg(
            organizationId,
            userId,
        );
        return { items };
    }

    // GET /chat/sessions/:id?userId=...
    @Get('sessions/:id')
    async getSession(
        @Param('id') id: string,
        @Query('userId') userId: string,
    ) {
        const session = await this.chat.getSessionById(id, userId);
        return { session };
    }

    // POST /chat/sessions
    @Post('sessions')
    async createSession(@Body() dto: CreateSessionDto) {
        const session = await this.chat.createSession(dto);
        return { session };
    }

    // POST /chat/sessions/:id/messages
    @Post('sessions/:id/messages')
    async sendMessage(
        @Param('id') id: string,
        @Body() dto: SendMessageDto,
    ) {
        const result = await this.chat.sendMessage({
            sessionId: id,
            userId: dto.userId,
            content: dto.content,
        });

        return result;
    }
}
