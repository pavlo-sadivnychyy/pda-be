import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import {
    Prisma,
    Organization,
    OrganizationRole,
    OrganizationMemberStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

type CreateOrganizationInput = {
    name: string;
    ownerId: string;

    description?: string | null;
    industry?: string | null;
    websiteUrl?: string | null;
    country?: string | null;
    city?: string | null;
    timeZone?: string | null;
    defaultLanguage?: string | null;
    defaultCurrency?: string | null;

    // Organization brand fields
    businessNiche?: string | null;
    servicesDescription?: string | null;
    targetAudience?: string | null;
    brandStyle?: string | null;

    // BusinessProfile short/long descriptions (як було)
    tagline?: string | null;
    niche?: string | null;
    longDescription?: string | null;
};

type UpdateOrganizationInput = {
    // організація
    name?: string;
    description?: string | null;
    industry?: string | null;
    websiteUrl?: string | null;
    country?: string | null;
    city?: string | null;
    timeZone?: string | null;
    defaultLanguage?: string | null;
    defaultCurrency?: string | null;

    // нові бренд-поля організації
    businessNiche?: string | null;
    servicesDescription?: string | null;
    targetAudience?: string | null;
    brandStyle?: string | null;

    // бренд / профіль (BusinessProfile)
    tagline?: string | null;
    niche?: string | null;
    longDescription?: string | null;
    targetAudienceSummary?: string | null;
    preferredPlatforms?: string[] | null;
};

type UserOrganizationWithUser = Prisma.UserOrganizationGetPayload<{
    include: { user: true };
}>;

@Injectable()
export class OrganizationsService {
    constructor(private readonly prisma: PrismaService) {}

    async createOrganization(input: CreateOrganizationInput) {
        if (!input.ownerId) {
            throw new BadRequestException('ownerId is required');
        }

        const owner = await this.prisma.user.findUnique({
            where: { id: input.ownerId },
        });

        if (!owner) {
            throw new BadRequestException('Owner user not found');
        }

        // 🔒 Перевірка: юзер вже є власником організації?
        const existingOrgForOwner = await this.prisma.organization.findFirst({
            where: { ownerId: input.ownerId },
        });

        if (existingOrgForOwner) {
            throw new BadRequestException(
                'User already owns an organization',
            );
        }

        const slug = await this.generateUniqueSlug(input.name);

        try {
            const organization = await this.prisma.organization.create({
                data: {
                    name: input.name,
                    slug,
                    ownerId: input.ownerId,
                    industry: input.industry ?? null,
                    description: input.description ?? null,
                    websiteUrl: input.websiteUrl ?? null,
                    country: input.country ?? null,
                    city: input.city ?? null,
                    timeZone: input.timeZone ?? null,
                    defaultLanguage: input.defaultLanguage ?? 'uk',
                    defaultCurrency: input.defaultCurrency ?? 'UAH',
                    primaryContactName: owner.fullName ?? owner.email,
                    primaryContactEmail: owner.email,
                    primaryContactPhone: null,

                    // нові поля організації
                    businessNiche:
                        input.businessNiche ?? input.niche ?? null,
                    servicesDescription:
                        input.servicesDescription ?? input.description ?? null,
                    targetAudience: input.targetAudience ?? null,
                    brandStyle: input.brandStyle ?? null,

                    // одразу додаємо owner як члена
                    members: {
                        create: {
                            userId: input.ownerId,
                            role: OrganizationRole.OWNER,
                            status: OrganizationMemberStatus.ACTIVE,
                            joinedAt: new Date(),
                        },
                    },

                    // businessProfile (як було раніше)
                    businessProfile: {
                        create: {
                            tagline:
                                input.tagline ?? `Бізнес ${input.name}`,
                            niche: input.niche ?? null,
                            longDescription:
                                input.longDescription ??
                                input.description ??
                                null,
                            targetAudienceSummary: null,
                            targetMarkets: [] as Prisma.InputJsonValue,
                            businessModel: null,
                            averageCheck: null,
                            defaultPostLength: 'medium',
                            preferredPlatforms: [
                                'instagram',
                                'email',
                            ] as Prisma.InputJsonValue,
                        },
                    },
                },
                include: {
                    businessProfile: true,
                    members: {
                        include: { user: true },
                    },
                },
            });

            return organization;
        } catch (e: any) {
            // колізія slug
            if (
                e instanceof
                Prisma.PrismaClientKnownRequestError &&
                e.code === 'P2002' &&
                Array.isArray(e.meta?.target) &&
                e.meta.target.includes('slug')
            ) {
                const existing =
                    await this.prisma.organization.findFirst({
                        where: { slug },
                        include: {
                            businessProfile: true,
                            members: { include: { user: true } },
                        },
                    });

                if (existing) {
                    return existing;
                }
            }

            console.error('Error creating organization', e);
            throw new BadRequestException(
                'Failed to create organization',
            );
        }
    }

    /**
     * Список організацій для юзера (або всі, якщо userId не переданий)
     * Використовується GET /organizations?userId=...
     */
    async getOrganizationsForUser(userId?: string) {
        if (userId) {
            const memberships =
                await this.prisma.userOrganization.findMany({
                    where: { userId },
                    include: {
                        organization: {
                            include: {
                                businessProfile: true,
                                members: {
                                    include: { user: true },
                                },
                            },
                        },
                    },
                    orderBy: { createdAt: 'asc' },
                });

            return memberships;
        }

        const organizations =
            await this.prisma.organization.findMany({
                include: {
                    businessProfile: true,
                    members: { include: { user: true } },
                },
                orderBy: { createdAt: 'asc' },
            });

        // щоб форма відповіді була схожа на memberships
        return organizations.map((org) => ({
            id: org.id,
            role: 'owner',
            status: 'active',
            userId: null,
            organizationId: org.id,
            organization: org,
            createdAt: (org as any)['createdAt'],
            updatedAt: (org as any)['updatedAt'],
        }));
    }

    /**
     * Деталі однієї організації
     * Використовується GET /organizations/:id
     */
    async getOrganizationById(id: string) {
        const organization =
            await this.prisma.organization.findUnique({
                where: { id },
                include: {
                    businessProfile: true,
                    members: {
                        include: { user: true },
                    },
                },
            });

        if (!organization) {
            throw new BadRequestException('Organization not found');
        }

        return organization;
    }

    /**
     * Оновлення організації + бренд-профілю
     * Використовується PATCH /organizations/:id
     */
    async updateOrganization(
        id: string,
        input: UpdateOrganizationInput,
    ) {
        const existing =
            await this.prisma.organization.findUnique({
                where: { id },
                include: { businessProfile: true },
            });

        if (!existing) {
            throw new BadRequestException('Organization not found');
        }

        const orgData: Prisma.OrganizationUpdateInput = {
            ...(input.name !== undefined && {
                name: input.name,
            }),
            ...(input.description !== undefined && {
                description: input.description,
            }),
            ...(input.industry !== undefined && {
                industry: input.industry,
            }),
            ...(input.websiteUrl !== undefined && {
                websiteUrl: input.websiteUrl,
            }),
            ...(input.country !== undefined && {
                country: input.country,
            }),
            ...(input.city !== undefined && {
                city: input.city,
            }),
            ...(input.timeZone !== undefined && {
                timeZone: input.timeZone,
            }),
            ...(input.defaultLanguage !== undefined && {
                defaultLanguage: input.defaultLanguage,
            }),
            ...(input.defaultCurrency !== undefined && {
                defaultCurrency: input.defaultCurrency,
            }),

            // нові поля організації
            ...(input.businessNiche !== undefined && {
                businessNiche: input.businessNiche,
            }),
            ...(input.servicesDescription !== undefined && {
                servicesDescription: input.servicesDescription,
            }),
            ...(input.targetAudience !== undefined && {
                targetAudience: input.targetAudience,
            }),
            ...(input.brandStyle !== undefined && {
                brandStyle: input.brandStyle,
            }),
        };

        const hasBrandUpdates =
            input.tagline !== undefined ||
            input.niche !== undefined ||
            input.longDescription !== undefined ||
            input.targetAudienceSummary !== undefined ||
            input.preferredPlatforms !== undefined;

        if (hasBrandUpdates) {
            const preferred = input.preferredPlatforms ?? undefined;

            orgData.businessProfile = {
                upsert: {
                    create: {
                        tagline: input.tagline ?? null,
                        niche: input.niche ?? null,
                        longDescription:
                            input.longDescription ?? null,
                        targetAudienceSummary:
                            input.targetAudienceSummary ?? null,
                        preferredPlatforms: (preferred ??
                            ['instagram', 'email']) as Prisma.InputJsonValue,
                        targetMarkets: [] as Prisma.InputJsonValue,
                        businessModel: null,
                        averageCheck: null,
                        defaultPostLength: 'medium',
                    },
                    update: {
                        ...(input.tagline !== undefined && {
                            tagline: input.tagline,
                        }),
                        ...(input.niche !== undefined && {
                            niche: input.niche,
                        }),
                        ...(input.longDescription !==
                            undefined && {
                                longDescription: input.longDescription,
                            }),
                        ...(input.targetAudienceSummary !==
                            undefined && {
                                targetAudienceSummary:
                                input.targetAudienceSummary,
                            }),
                        ...(input.preferredPlatforms !==
                            undefined && {
                                preferredPlatforms: (preferred ??
                                    []) as Prisma.InputJsonValue,
                            }),
                    },
                },
            };
        }

        const updated =
            await this.prisma.organization.update({
                where: { id },
                data: orgData,
                include: {
                    businessProfile: true,
                    members: {
                        include: { user: true },
                    },
                },
            });

        return updated;
    }

    async getOrganizationMembers(
        organizationId: string,
        currentUserId: string,
    ) {
        // будь-який член організації може бачити список
        await this.ensureUserInOrganization(
            organizationId,
            currentUserId,
        );

        const memberships =
            await this.prisma.userOrganization.findMany({
                where: { organizationId },
                include: {
                    user: true,
                },
                orderBy: {
                    role: 'asc',
                },
            });

        return memberships.map((m) => ({
            userId: m.userId,
            organizationId: m.organizationId,
            role: m.role,
            status: m.status,
            joinedAt: m.joinedAt,
            user: {
                id: m.user.id,
                fullName: m.user.fullName,
                email: m.user.email,
            },
        }));
    }

    async addMember(
        organizationId: string,
        input: {
            currentUserId: string;
            userId: string;
            role?: OrganizationRole;
        },
    ) {
        const { currentUserId, userId, role } = input;

        await this.ensureOwner(organizationId, currentUserId);

        if (currentUserId === userId) {
            throw new BadRequestException(
                'Owner вже є учасником цієї організації',
            );
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new BadRequestException(
                'Користувача не знайдено',
            );
        }

        const existing =
            await this.prisma.userOrganization.findFirst({
                where: { organizationId, userId },
            });

        if (existing) {
            throw new BadRequestException(
                'Користувач вже є учасником цієї організації',
            );
        }

        const membership: UserOrganizationWithUser =
            await this.prisma.userOrganization.create({
                data: {
                    organizationId,
                    userId,
                    role: role ?? OrganizationRole.MEMBER,
                    status: OrganizationMemberStatus.ACTIVE,
                    joinedAt: new Date(),
                },
                include: {
                    user: true,
                },
            });

        return {
            userId: membership.userId,
            organizationId: membership.organizationId,
            role: membership.role,
            status: membership.status,
            joinedAt: membership.joinedAt,
            user: {
                id: membership.user.id,
                fullName: membership.user.fullName,
                email: membership.user.email,
            },
        };
    }

    async updateMemberRole(
        organizationId: string,
        memberUserId: string,
        input: { currentUserId: string; role: OrganizationRole },
    ) {
        const { currentUserId, role } = input;

        await this.ensureOwner(organizationId, currentUserId);

        if (
            currentUserId === memberUserId &&
            role === OrganizationRole.MEMBER
        ) {
            throw new ForbiddenException(
                'Owner не може понизити свою роль до MEMBER',
            );
        }

        const membership =
            await this.prisma.userOrganization.findFirst({
                where: { organizationId, userId: memberUserId },
            });

        if (!membership) {
            throw new BadRequestException(
                'Цей користувач не є членом організації',
            );
        }

        const updated =
            await this.prisma.userOrganization.update({
                where: {
                    // @@unique([userId, organizationId]) -> userId_organizationId
                    userId_organizationId: {
                        userId: memberUserId,
                        organizationId,
                    },
                },
                data: { role },
                include: {
                    user: true,
                },
            });

        return {
            userId: updated.userId,
            organizationId: updated.organizationId,
            role: updated.role,
            status: updated.status,
            joinedAt: updated.joinedAt,
            user: {
                id: updated.user.id,
                fullName: updated.user.fullName,
                email: updated.user.email,
            },
        };
    }

    async removeMember(
        organizationId: string,
        memberUserId: string,
        currentUserId: string,
    ) {
        await this.ensureOwner(organizationId, currentUserId);

        if (currentUserId === memberUserId) {
            throw new ForbiddenException(
                'Owner не може видалити сам себе з організації',
            );
        }

        await this.prisma.userOrganization.deleteMany({
            where: {
                organizationId,
                userId: memberUserId,
            },
        });

        return { success: true };
    }

    private async ensureUserInOrganization(
        organizationId: string,
        userId: string,
    ) {
        const membership =
            await this.prisma.userOrganization.findFirst({
                where: { organizationId, userId },
                include: {
                    user: true,
                },
            });

        if (!membership) {
            throw new ForbiddenException(
                'Користувач не належить до цієї організації',
            );
        }

        return membership;
    }

    private async ensureOwner(
        organizationId: string,
        userId: string,
    ) {
        const membership =
            await this.prisma.userOrganization.findFirst({
                where: { organizationId, userId },
            });

        if (
            !membership ||
            membership.role !== OrganizationRole.OWNER
        ) {
            throw new ForbiddenException(
                'Тільки OWNER може керувати командою організації',
            );
        }

        return membership;
    }

    /**
     * Генерація унікального slug
     */
    private async generateUniqueSlug(
        name: string,
    ): Promise<string> {
        const base = name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-') // все не-латиниця/цифри → '-'
            .replace(/^-+|-+$/g, '');

        const safeBase = base.length ? base : 'org';

        let slug = safeBase;
        let counter = 1;

        while (true) {
            const exists: Organization | null =
                await this.prisma.organization.findUnique({
                    where: { slug },
                });

            if (!exists) {
                return slug;
            }

            slug = `${safeBase}-${counter++}`;
        }
    }
}
