import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { PlanId } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

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

class SetUserPlanDto {
  planId: PlanId;
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

  @Patch(':id/plan')
  async setPlan(@Param('id') id: string, @Body() body: SetUserPlanDto) {
    const user = await this.usersService.setUserPlan(id, body.planId);
    return { user };
  }

  // ✅ Оце головне: цей роут повинен брати authUserId з Bearer токена
  @Patch('onboarding/complete')
  @UseGuards(ClerkAuthGuard)
  async completeOnboarding(@Req() req: any) {
    return this.usersService.completeOnboarding(req.authUserId);
  }
}
