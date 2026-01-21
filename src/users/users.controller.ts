import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { PlanId } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

class SyncUserDto {
  authProvider: string;
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

  // ✅ PROTECTED + authUserId береться тільки з токена
  @Post('sync')
  @UseGuards(ClerkAuthGuard)
  async syncUser(@Req() req: any, @Body() body: SyncUserDto) {
    const user = await this.usersService.upsertUser({
      authProvider: body.authProvider,
      authUserId: req.authUserId, // ✅ тільки з токена
      email: body.email,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      avatarUrl: body.avatarUrl ?? null,
      locale: body.locale ?? null,
      timezone: body.timezone ?? null,
      jobTitle: body.jobTitle ?? null,
    });

    return { user };
  }

  // (опціонально) також прикрий setPlan — щоб не можна було міняти чужим
  @Patch(':id/plan')
  @UseGuards(ClerkAuthGuard)
  async setPlan(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SetUserPlanDto,
  ) {
    // ✅ знаходимо DB user по authUserId і звіряємо
    const me = await this.usersService.findByAuthUserId(req.authUserId);
    if (!me || me.id !== id) {
      throw new ForbiddenException(
        'You can change plan only for your own user',
      );
    }

    const user = await this.usersService.setUserPlan(id, body.planId);
    return { user };
  }

  @Get(':id')
  @UseGuards(ClerkAuthGuard)
  async getById(@Req() req: any, @Param('id') id: string) {
    const me = await this.usersService.findByAuthUserId(req.authUserId);
    if (!me || me.id !== id) {
      throw new ForbiddenException('You can access only your own user');
    }

    const user = await this.usersService.findById(id);
    return { user };
  }

  @Patch('onboarding/complete')
  @UseGuards(ClerkAuthGuard)
  async completeOnboarding(@Req() req: any) {
    return this.usersService.completeOnboarding(req.authUserId);
  }
}
