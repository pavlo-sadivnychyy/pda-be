// organizations.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  AddMemberDto,
  UpdateMemberRoleDto,
} from './dto/organization-members.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

class CreateOrganizationDto {
  name: string;

  industry?: string;
  description?: string;
  websiteUrl?: string;
  country?: string;
  city?: string;
  timeZone?: string;
  defaultLanguage?: string;
  defaultCurrency?: string;

  businessNiche?: string;
  servicesDescription?: string;
  targetAudience?: string;
  brandStyle?: string;

  // =========================
  // ✅ UA payment details
  // =========================
  uaCompanyName?: string;
  uaCompanyAddress?: string;
  uaEdrpou?: string;
  uaIpn?: string;
  uaIban?: string;
  uaBankName?: string;
  uaMfo?: string;
  uaAccountNumber?: string;
  uaBeneficiaryName?: string;
  uaPaymentPurposeHint?: string;

  // =========================
  // ✅ International payment details
  // =========================
  intlLegalName?: string;
  intlBeneficiaryName?: string;
  intlLegalAddress?: string;
  intlVatId?: string;
  intlRegistrationNumber?: string;
  intlIban?: string;
  intlSwiftBic?: string;
  intlBankName?: string;
  intlBankAddress?: string;
  intlPaymentReferenceHint?: string;

  tagline?: string;
  niche?: string;
  longDescription?: string;
}

class UpdateOrganizationDto {
  name?: string;
  description?: string;
  industry?: string;
  websiteUrl?: string;
  country?: string;
  city?: string;
  timeZone?: string;
  defaultLanguage?: string;
  defaultCurrency?: string;

  businessNiche?: string;
  servicesDescription?: string;
  targetAudience?: string;
  brandStyle?: string;

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

  tagline?: string;
  niche?: string;
  longDescription?: string;
  targetAudienceSummary?: string;
  preferredPlatforms?: string[];
}

@UseGuards(ClerkAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(@Req() req: any, @Body() body: CreateOrganizationDto) {
    if (!body.name) {
      throw new BadRequestException('name is required');
    }

    const org = await this.organizationsService.createOrganization(
      req.authUserId,
      body,
    );
    return { organization: org };
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateOrganizationDto,
  ) {
    const org = await this.organizationsService.updateOrganization(
      req.authUserId,
      id,
      body,
    );
    return { organization: org };
  }

  @Get()
  async getForCurrentUser(@Req() req: any) {
    const links =
      await this.organizationsService.getOrganizationsForCurrentUser(
        req.authUserId,
      );
    return { items: links };
  }

  @Get(':id')
  async getById(@Req() req: any, @Param('id') id: string) {
    const org = await this.organizationsService.getOrganizationById(
      req.authUserId,
      id,
    );
    return { organization: org };
  }

  @Get(':id/members')
  async getMembers(@Req() req: any, @Param('id') organizationId: string) {
    const items = await this.organizationsService.getOrganizationMembers(
      req.authUserId,
      organizationId,
    );
    return { items };
  }

  @Post(':id/members')
  async addMember(
    @Req() req: any,
    @Param('id') organizationId: string,
    @Body() dto: AddMemberDto,
  ) {
    const member = await this.organizationsService.addMember(
      req.authUserId,
      organizationId,
      dto,
    );
    return { member };
  }

  @Patch(':id/members/:userId')
  async updateMemberRole(
    @Req() req: any,
    @Param('id') organizationId: string,
    @Param('userId') memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    const member = await this.organizationsService.updateMemberRole(
      req.authUserId,
      organizationId,
      memberUserId,
      dto,
    );
    return { member };
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @Req() req: any,
    @Param('id') organizationId: string,
    @Param('userId') memberUserId: string,
  ) {
    const result = await this.organizationsService.removeMember(
      req.authUserId,
      organizationId,
      memberUserId,
    );
    return result;
  }
}
