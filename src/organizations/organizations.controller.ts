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

  // ✅ payment details
  legalName?: string;
  beneficiaryName?: string;
  legalAddress?: string;
  vatId?: string;
  registrationNumber?: string;
  iban?: string;
  swiftBic?: string;
  bankName?: string;
  bankAddress?: string;
  paymentReferenceHint?: string;

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

  // ✅ payment details
  legalName?: string | null;
  beneficiaryName?: string | null;
  legalAddress?: string | null;
  vatId?: string | null;
  registrationNumber?: string | null;
  iban?: string | null;
  swiftBic?: string | null;
  bankName?: string | null;
  bankAddress?: string | null;
  paymentReferenceHint?: string | null;

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

  // ✅ create org for current auth user (без ownerId з фронта)
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

  // ✅ update only by owner (service check)
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

  // ✅ get orgs for current user (без userId query)
  @Get()
  async getForCurrentUser(@Req() req: any) {
    const links =
      await this.organizationsService.getOrganizationsForCurrentUser(
        req.authUserId,
      );
    return { items: links };
  }

  // ✅ get by id (service checks membership)
  @Get(':id')
  async getById(@Req() req: any, @Param('id') id: string) {
    const org = await this.organizationsService.getOrganizationById(
      req.authUserId,
      id,
    );
    return { organization: org };
  }

  // ✅ members (service checks membership)
  @Get(':id/members')
  async getMembers(@Req() req: any, @Param('id') organizationId: string) {
    const items = await this.organizationsService.getOrganizationMembers(
      req.authUserId,
      organizationId,
    );
    return { items };
  }

  // ✅ add member (service checks owner)
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

  // ✅ update role (service checks owner)
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

  // ✅ remove member (service checks owner)
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
