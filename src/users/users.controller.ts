import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UsersService } from './users.service';

class SyncUserDto {
    authProvider: string;
    authUserId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    locale?: string;
    timezone?: string;
    jobTitle?: string;
}

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Post('sync')
    async syncUser(@Body() body: SyncUserDto) {
        const user = await this.usersService.upsertUser(body);
        return { user };
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        const user = await this.usersService.findById(id);
        return { user };
    }
}
