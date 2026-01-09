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

  /**
   * ✅ Upsert user by authUserId
   * ✅ Guarantee subscription exists:
   *    - create subscription with FREE on first sync
   *    - do NOT override plan on subsequent syncs
   * ✅ Return user with subscription
   */
  async upsertUser(input: UpsertUserInput) {
    const fullName = [input.firstName, input.lastName]
      .filter(Boolean)
      .join(' ');

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

    // ✅ гарантуємо, що subscription існує (FREE by default)
    // sync НЕ міняє план — тільки створює якщо її не було
    await this.prisma.subscription.upsert({
      where: { userId: user.id }, // userId має бути @unique в Subscription
      create: {
        userId: user.id,
        planId: PlanId.FREE,
        status: 'active',
      },
      update: {}, // ❗ нічого не оновлюємо на sync
    });

    // ✅ повертаємо user + subscription
    return this.prisma.user.findUnique({
      where: { id: user.id },
      include: { subscription: true },
    });
  }

  // ✅ User + subscription
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

  /**
   * ✅ Set/Change plan for user:
   * - upsert subscription (create if missing, otherwise update planId)
   * - return user + subscription
   */
  async setUserPlan(userId: string, planId: PlanId) {
    if (!planId) throw new BadRequestException('planId is required');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        planId,
        status: 'active',
      },
      update: {
        planId,
      },
    });

    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
  }
}
