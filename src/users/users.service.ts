import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanId } from '@prisma/client';

type UpsertUserInput = {
  authProvider: string;
  authUserId: string;
  email: string;

  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
  timezone?: string | null;
  jobTitle?: string | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertUser(input: UpsertUserInput) {
    if (!input.authUserId) {
      throw new BadRequestException('authUserId is required');
    }
    if (!input.email) {
      throw new BadRequestException('email is required');
    }
    if (!input.authProvider) {
      throw new BadRequestException('authProvider is required');
    }

    const fullName = [input.firstName, input.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    const user = await this.prisma.user.upsert({
      where: { authUserId: input.authUserId },
      create: {
        authProvider: input.authProvider,
        authUserId: input.authUserId,
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        fullName: fullName || null,
        avatarUrl: input.avatarUrl ?? null,
        locale: input.locale ?? null,
        timezone: input.timezone ?? null,
        jobTitle: input.jobTitle ?? null,
        lastLoginAt: new Date(),
      },
      update: {
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        fullName: fullName || null,
        avatarUrl: input.avatarUrl ?? null,
        locale: input.locale ?? null,
        timezone: input.timezone ?? null,
        jobTitle: input.jobTitle ?? null,
        lastLoginAt: new Date(),
      },
    });

    // ✅ гарантуємо, що subscription існує
    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        planId: PlanId.FREE,
        status: 'active',
      },
      update: {},
    });

    return this.prisma.user.findUnique({
      where: { id: user.id },
      include: { subscription: true },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { subscription: true },
    });
  }

  async findByAuthUserId(authUserId: string) {
    return this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
  }

  async completeOnboarding(authUserId: string) {
    if (!authUserId) {
      throw new BadRequestException('authUserId is required');
    }

    const user = await this.prisma.user.findUnique({ where: { authUserId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { authUserId },
      data: { onboardingCompleted: true },
      select: { id: true, onboardingCompleted: true },
    });

    return { user: updated };
  }

  async setUserPlan(userId: string, planId: PlanId) {
    if (!planId) throw new BadRequestException('planId is required');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.subscription.upsert({
      where: { userId },
      create: { userId, planId, status: 'active' },
      update: { planId },
    });

    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
  }
}
