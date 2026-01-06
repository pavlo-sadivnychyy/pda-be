import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

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

    async upsertUser(input: UpsertUserInput): Promise<User> {
        const fullName = [input.firstName, input.lastName].filter(Boolean).join(' ');

        return this.prisma.user.upsert({
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
    }

    async findById(id: string) {
        return this.prisma.user.findUnique({ where: { id } });
    }

    async findByAuthUserId(authUserId: string) {
        return this.prisma.user.findUnique({ where: { authUserId } });
    }
}
