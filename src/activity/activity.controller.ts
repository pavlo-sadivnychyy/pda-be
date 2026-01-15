import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityEntityType, ActivityEventType } from '@prisma/client';

@UseGuards(ClerkAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly prisma: PrismaService,
  ) {}

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

  private async assertOrgAccess(dbUserId: string, organizationId: string) {
    if (!organizationId)
      throw new BadRequestException('organizationId is required');

    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId: dbUserId, organizationId } },
      select: { id: true },
    });

    if (!membership)
      throw new BadRequestException('No access to this organization');
  }

  // GET /activity?organizationId=...&limit=...&cursor=...&entityType=INVOICE&eventType=SENT&entityId=...
  @Get()
  async list(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('entityType') entityType?: ActivityEntityType,
    @Query('eventType') eventType?: ActivityEventType,
    @Query('entityId') entityId?: string,
  ) {
    const dbUserId = await this.resolveDbUserId(req.authUserId);
    await this.assertOrgAccess(dbUserId, organizationId);

    return this.activity.list({
      organizationId,
      limit: limit != null ? Number(limit) : undefined,
      cursor: cursor ?? null,
      entityType,
      eventType,
      entityId,
    });
  }

  // GET /activity/latest?organizationId=...&limit=3
  @Get('latest')
  async latest(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
    @Query('limit') limit?: string,
  ) {
    const dbUserId = await this.resolveDbUserId(req.authUserId);
    await this.assertOrgAccess(dbUserId, organizationId);

    return this.activity.latest({
      organizationId,
      limit: limit != null ? Number(limit) : 3,
    });
  }

  // ✅ NEW: GET /activity/recent?organizationId=...&limit=3
  // alias to /activity/latest so фронт може викликати /activity/recent
  @Get('recent')
  async recent(
    @Req() req: any,
    @Query('organizationId') organizationId: string,
    @Query('limit') limit?: string,
  ) {
    const dbUserId = await this.resolveDbUserId(req.authUserId);
    await this.assertOrgAccess(dbUserId, organizationId);

    return this.activity.latest({
      organizationId,
      limit: limit != null ? Number(limit) : 3,
    });
  }
}
