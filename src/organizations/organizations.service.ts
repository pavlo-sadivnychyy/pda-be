// organizations.service.ts

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

  description?: string | null;
  industry?: string | null;
  websiteUrl?: string | null;
  country?: string | null;
  city?: string | null;
  timeZone?: string | null;
  defaultLanguage?: string | null;
  defaultCurrency?: string | null;

  businessNiche?: string | null;
  servicesDescription?: string | null;
  targetAudience?: string | null;
  brandStyle?: string | null;

  // =========================
  // ✅ UA payment details
  // =========================
  uaCompanyName?: string | null;
  uaCompanyAddress?: string | null;
  uaEdrpou?: string | null;
  uaIpn?: string | null;
  uaIban?: string | null;
  uaBankName?: string | null;
  uaMfo?: string | null;
  uaAccountNumber?: string | null;
  uaBeneficiaryName?: string | null;
  uaPaymentPurposeHint?: string | null;

  // =========================
  // ✅ International payment details
  // =========================
  intlLegalName?: string | null;
  intlBeneficiaryName?: string | null;
  intlLegalAddress?: string | null;
  intlVatId?: string | null;
  intlRegistrationNumber?: string | null;
  intlIban?: string | null;
  intlSwiftBic?: string | null;
  intlBankName?: string | null;
  intlBankAddress?: string | null;
  intlPaymentReferenceHint?: string | null;

  // brand profile fields
  tagline?: string | null;
  niche?: string | null;
  longDescription?: string | null;
};

type UpdateOrganizationInput = {
  name?: string;
  description?: string | null;
  industry?: string | null;
  websiteUrl?: string | null;
  country?: string | null;
  city?: string | null;
  timeZone?: string | null;
  defaultLanguage?: string | null;
  defaultCurrency?: string | null;

  businessNiche?: string | null;
  servicesDescription?: string | null;
  targetAudience?: string | null;
  brandStyle?: string | null;

  // =========================
  // ✅ UA payment details
  // =========================
  uaCompanyName?: string | null;
  uaCompanyAddress?: string | null;
  uaEdrpou?: string | null;
  uaIpn?: string | null;
  uaIban?: string | null;
  uaBankName?: string | null;
  uaMfo?: string | null;
  uaAccountNumber?: string | null;
  uaBeneficiaryName?: string | null;
  uaPaymentPurposeHint?: string | null;

  // =========================
  // ✅ International payment details
  // =========================
  intlLegalName?: string | null;
  intlBeneficiaryName?: string | null;
  intlLegalAddress?: string | null;
  intlVatId?: string | null;
  intlRegistrationNumber?: string | null;
  intlIban?: string | null;
  intlSwiftBic?: string | null;
  intlBankName?: string | null;
  intlBankAddress?: string | null;
  intlPaymentReferenceHint?: string | null;

  // brand profile fields
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

  // ✅ clerk authUserId -> db userId
  private async resolveDbUserId(authUserId: string): Promise<string> {
    if (!authUserId) throw new BadRequestException('Missing auth user');

    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException(
        'User not found in DB. Call /users/sync first.',
      );
    }

    return user.id;
  }

  async createOrganization(authUserId: string, input: CreateOrganizationInput) {
    const ownerId = await this.resolveDbUserId(authUserId);
    if (!ownerId) throw new BadRequestException('ownerId is required');

    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
    });
    if (!owner) throw new BadRequestException('Owner user not found');

    const existingOrgForOwner = await this.prisma.organization.findFirst({
      where: { ownerId },
    });
    if (existingOrgForOwner) {
      throw new BadRequestException('User already owns an organization');
    }

    const slug = await this.generateUniqueSlug(input.name);

    try {
      const organization = await this.prisma.organization.create({
        data: {
          name: input.name,
          slug,
          ownerId,

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

          businessNiche: input.businessNiche ?? input.niche ?? null,
          servicesDescription:
            input.servicesDescription ?? input.description ?? null,
          targetAudience: input.targetAudience ?? null,
          brandStyle: input.brandStyle ?? null,

          // =========================
          // ✅ UA payment details
          // =========================
          uaCompanyName: input.uaCompanyName ?? null,
          uaCompanyAddress: input.uaCompanyAddress ?? null,
          uaEdrpou: input.uaEdrpou ?? null,
          uaIpn: input.uaIpn ?? null,
          uaIban: input.uaIban ?? null,
          uaBankName: input.uaBankName ?? null,
          uaMfo: input.uaMfo ?? null,
          uaAccountNumber: input.uaAccountNumber ?? null,
          uaBeneficiaryName: input.uaBeneficiaryName ?? null,
          uaPaymentPurposeHint: input.uaPaymentPurposeHint ?? null,

          // =========================
          // ✅ International payment details
          // =========================
          intlLegalName: input.intlLegalName ?? null,
          intlBeneficiaryName: input.intlBeneficiaryName ?? null,
          intlLegalAddress: input.intlLegalAddress ?? null,
          intlVatId: input.intlVatId ?? null,
          intlRegistrationNumber: input.intlRegistrationNumber ?? null,
          intlIban: input.intlIban ?? null,
          intlSwiftBic: input.intlSwiftBic ?? null,
          intlBankName: input.intlBankName ?? null,
          intlBankAddress: input.intlBankAddress ?? null,
          intlPaymentReferenceHint: input.intlPaymentReferenceHint ?? null,

          members: {
            create: {
              userId: ownerId,
              role: OrganizationRole.OWNER,
              status: OrganizationMemberStatus.ACTIVE,
              joinedAt: new Date(),
            },
          },

          businessProfile: {
            create: {
              tagline: input.tagline ?? `Бізнес ${input.name}`,
              niche: input.niche ?? null,
              longDescription:
                input.longDescription ?? input.description ?? null,
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
          members: { include: { user: true } },
        },
      });

      return organization;
    } catch (e: any) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        Array.isArray(e.meta?.target) &&
        e.meta.target.includes('slug')
      ) {
        const existing = await this.prisma.organization.findFirst({
          where: { slug },
          include: {
            businessProfile: true,
            members: { include: { user: true } },
          },
        });
        if (existing) return existing;
      }

      console.error('Error creating organization', e);
      throw new BadRequestException('Failed to create organization');
    }
  }

  // ✅ тепер повертаємо організації поточного користувача (без userId з query)
  async getOrganizationsForCurrentUser(authUserId: string) {
    const userId = await this.resolveDbUserId(authUserId);

    const memberships = await this.prisma.userOrganization.findMany({
      where: { userId },
      include: {
        organization: {
          include: {
            businessProfile: true,
            members: { include: { user: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships;
  }

  async getOrganizationById(authUserId: string, id: string) {
    const userId = await this.resolveDbUserId(authUserId);

    // ✅ перевіряємо доступ (membership або owner)
    await this.ensureUserInOrganization(id, userId);

    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: { businessProfile: true, members: { include: { user: true } } },
    });

    if (!organization) throw new BadRequestException('Organization not found');
    return organization;
  }

  async updateOrganization(
    authUserId: string,
    id: string,
    input: UpdateOrganizationInput,
  ) {
    const userId = await this.resolveDbUserId(authUserId);

    // ✅ тільки OWNER може апдейтити
    await this.ensureOwner(id, userId);

    const existing = await this.prisma.organization.findUnique({
      where: { id },
      include: { businessProfile: true },
    });
    if (!existing) throw new BadRequestException('Organization not found');

    const orgData: Prisma.OrganizationUpdateInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.industry !== undefined && { industry: input.industry }),
      ...(input.websiteUrl !== undefined && { websiteUrl: input.websiteUrl }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
      ...(input.defaultLanguage !== undefined && {
        defaultLanguage: input.defaultLanguage,
      }),
      ...(input.defaultCurrency !== undefined && {
        defaultCurrency: input.defaultCurrency,
      }),

      ...(input.businessNiche !== undefined && {
        businessNiche: input.businessNiche,
      }),
      ...(input.servicesDescription !== undefined && {
        servicesDescription: input.servicesDescription,
      }),
      ...(input.targetAudience !== undefined && {
        targetAudience: input.targetAudience,
      }),
      ...(input.brandStyle !== undefined && { brandStyle: input.brandStyle }),

      // =========================
      // ✅ UA payment details
      // =========================
      ...(input.uaCompanyName !== undefined && {
        uaCompanyName: input.uaCompanyName,
      }),
      ...(input.uaCompanyAddress !== undefined && {
        uaCompanyAddress: input.uaCompanyAddress,
      }),
      ...(input.uaEdrpou !== undefined && { uaEdrpou: input.uaEdrpou }),
      ...(input.uaIpn !== undefined && { uaIpn: input.uaIpn }),
      ...(input.uaIban !== undefined && { uaIban: input.uaIban }),
      ...(input.uaBankName !== undefined && { uaBankName: input.uaBankName }),
      ...(input.uaMfo !== undefined && { uaMfo: input.uaMfo }),
      ...(input.uaAccountNumber !== undefined && {
        uaAccountNumber: input.uaAccountNumber,
      }),
      ...(input.uaBeneficiaryName !== undefined && {
        uaBeneficiaryName: input.uaBeneficiaryName,
      }),
      ...(input.uaPaymentPurposeHint !== undefined && {
        uaPaymentPurposeHint: input.uaPaymentPurposeHint,
      }),

      // =========================
      // ✅ International payment details
      // =========================
      ...(input.intlLegalName !== undefined && {
        intlLegalName: input.intlLegalName,
      }),
      ...(input.intlBeneficiaryName !== undefined && {
        intlBeneficiaryName: input.intlBeneficiaryName,
      }),
      ...(input.intlLegalAddress !== undefined && {
        intlLegalAddress: input.intlLegalAddress,
      }),
      ...(input.intlVatId !== undefined && { intlVatId: input.intlVatId }),
      ...(input.intlRegistrationNumber !== undefined && {
        intlRegistrationNumber: input.intlRegistrationNumber,
      }),
      ...(input.intlIban !== undefined && { intlIban: input.intlIban }),
      ...(input.intlSwiftBic !== undefined && {
        intlSwiftBic: input.intlSwiftBic,
      }),
      ...(input.intlBankName !== undefined && {
        intlBankName: input.intlBankName,
      }),
      ...(input.intlBankAddress !== undefined && {
        intlBankAddress: input.intlBankAddress,
      }),
      ...(input.intlPaymentReferenceHint !== undefined && {
        intlPaymentReferenceHint: input.intlPaymentReferenceHint,
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
            longDescription: input.longDescription ?? null,
            targetAudienceSummary: input.targetAudienceSummary ?? null,
            preferredPlatforms: (preferred ?? [
              'instagram',
              'email',
            ]) as Prisma.InputJsonValue,
            targetMarkets: [] as Prisma.InputJsonValue,
            businessModel: null,
            averageCheck: null,
            defaultPostLength: 'medium',
          },
          update: {
            ...(input.tagline !== undefined && { tagline: input.tagline }),
            ...(input.niche !== undefined && { niche: input.niche }),
            ...(input.longDescription !== undefined && {
              longDescription: input.longDescription,
            }),
            ...(input.targetAudienceSummary !== undefined && {
              targetAudienceSummary: input.targetAudienceSummary,
            }),
            ...(input.preferredPlatforms !== undefined && {
              preferredPlatforms: (preferred ?? []) as Prisma.InputJsonValue,
            }),
          },
        },
      };
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: orgData,
      include: { businessProfile: true, members: { include: { user: true } } },
    });

    return updated;
  }

  async getOrganizationMembers(authUserId: string, organizationId: string) {
    const currentUserId = await this.resolveDbUserId(authUserId);

    await this.ensureUserInOrganization(organizationId, currentUserId);

    const memberships = await this.prisma.userOrganization.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { role: 'asc' },
    });

    return memberships.map((m) => ({
      userId: m.userId,
      organizationId: m.organizationId,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
      user: { id: m.user.id, fullName: m.user.fullName, email: m.user.email },
    }));
  }

  async addMember(
    authUserId: string,
    organizationId: string,
    input: { userId: string; role?: OrganizationRole },
  ) {
    const currentUserId = await this.resolveDbUserId(authUserId);
    const { userId, role } = input;

    await this.ensureOwner(organizationId, currentUserId);

    if (currentUserId === userId) {
      throw new BadRequestException('Owner вже є учасником цієї організації');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Користувача не знайдено');

    const existing = await this.prisma.userOrganization.findFirst({
      where: { organizationId, userId },
    });
    if (existing)
      throw new BadRequestException(
        'Користувач вже є учасником цієї організації',
      );

    const membership: UserOrganizationWithUser =
      await this.prisma.userOrganization.create({
        data: {
          organizationId,
          userId,
          role: role ?? OrganizationRole.MEMBER,
          status: OrganizationMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
        include: { user: true },
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
    authUserId: string,
    organizationId: string,
    memberUserId: string,
    input: { role: OrganizationRole },
  ) {
    const currentUserId = await this.resolveDbUserId(authUserId);
    const { role } = input;

    await this.ensureOwner(organizationId, currentUserId);

    if (currentUserId === memberUserId && role === OrganizationRole.MEMBER) {
      throw new ForbiddenException(
        'Owner не може понизити свою роль до MEMBER',
      );
    }

    const membership = await this.prisma.userOrganization.findFirst({
      where: { organizationId, userId: memberUserId },
    });
    if (!membership)
      throw new BadRequestException('Цей користувач не є членом організації');

    const updated = await this.prisma.userOrganization.update({
      where: {
        userId_organizationId: { userId: memberUserId, organizationId },
      },
      data: { role },
      include: { user: true },
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
    authUserId: string,
    organizationId: string,
    memberUserId: string,
  ) {
    const currentUserId = await this.resolveDbUserId(authUserId);

    await this.ensureOwner(organizationId, currentUserId);

    if (currentUserId === memberUserId) {
      throw new ForbiddenException(
        'Owner не може видалити сам себе з організації',
      );
    }

    await this.prisma.userOrganization.deleteMany({
      where: { organizationId, userId: memberUserId },
    });

    return { success: true };
  }

  private async ensureUserInOrganization(
    organizationId: string,
    userId: string,
  ) {
    const membership = await this.prisma.userOrganization.findFirst({
      where: { organizationId, userId },
    });

    if (!membership)
      throw new ForbiddenException(
        'Користувач не належить до цієї організації',
      );
    return membership;
  }

  private async ensureOwner(organizationId: string, userId: string) {
    const membership = await this.prisma.userOrganization.findFirst({
      where: { organizationId, userId },
    });

    if (!membership || membership.role !== OrganizationRole.OWNER) {
      throw new ForbiddenException(
        'Тільки OWNER може керувати командою організації',
      );
    }

    return membership;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const safeBase = base.length ? base : 'org';
    let slug = safeBase;
    let counter = 1;

    while (true) {
      const exists: Organization | null =
        await this.prisma.organization.findUnique({
          where: { slug },
        });

      if (!exists) return slug;
      slug = `${safeBase}-${counter++}`;
    }
  }
}
