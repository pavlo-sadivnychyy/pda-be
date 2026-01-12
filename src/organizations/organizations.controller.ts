import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Patch,
  Delete,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  AddMemberDto,
  UpdateMemberRoleDto,
} from './dto/organization-members.dto';

class CreateOrganizationDto {
  name: string;
  ownerId: string;

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

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(@Body() body: CreateOrganizationDto) {
    if (!body.name || !body.ownerId) {
      throw new BadRequestException('name and ownerId are required');
    }

    const org = await this.organizationsService.createOrganization(body);
    return { organization: org };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateOrganizationDto) {
    const org = await this.organizationsService.updateOrganization(id, body);
    return { organization: org };
  }

  @Get()
  async getForUser(@Query('userId') userId?: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }

    const links =
      await this.organizationsService.getOrganizationsForUser(userId);
    return { items: links };
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const org = await this.organizationsService.getOrganizationById(id);
    if (!org) throw new BadRequestException('Organization not found');
    return { organization: org };
  }

  @Get(':id/members')
  async getMembers(
    @Param('id') organizationId: string,
    @Query('currentUserId') currentUserId: string,
  ) {
    const items = await this.organizationsService.getOrganizationMembers(
      organizationId,
      currentUserId,
    );
    return { items };
  }

  @Post(':id/members')
  async addMember(
    @Param('id') organizationId: string,
    @Body() dto: AddMemberDto,
  ) {
    const member = await this.organizationsService.addMember(
      organizationId,
      dto,
    );
    return { member };
  }

  @Patch(':id/members/:userId')
  async updateMemberRole(
    @Param('id') organizationId: string,
    @Param('userId') memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    const member = await this.organizationsService.updateMemberRole(
      organizationId,
      memberUserId,
      dto,
    );
    return { member };
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id') organizationId: string,
    @Param('userId') memberUserId: string,
    @Query('currentUserId') currentUserId: string,
  ) {
    const result = await this.organizationsService.removeMember(
      organizationId,
      memberUserId,
      currentUserId,
    );
    return result;
  }
}
