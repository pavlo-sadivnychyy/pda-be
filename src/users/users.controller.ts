import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { PlanId } from '@prisma/client';

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

// ✅ Окремий DTO тільки для зміни плану
class SetUserPlanDto {
  planId: PlanId;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ✅ Реєстрація/логін/синк. Тут НЕ приймаємо subscription з клієнта.
  // При першому вході підписка створюється автоматично з FREE.
  @Post('sync')
  async syncUser(@Body() body: SyncUserDto) {
    const user = await this.usersService.upsertUser(body);
    return { user };
  }

  // ✅ User + subscription
  @Get(':id')
  async getById(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    return { user };
  }

  // ✅ Зміна плану (upsert subscription, потім повертаємо user + subscription)
  @Patch(':id/plan')
  async setPlan(@Param('id') id: string, @Body() body: SetUserPlanDto) {
    const user = await this.usersService.setUserPlan(id, body.planId);
    return { user };
  }
}
