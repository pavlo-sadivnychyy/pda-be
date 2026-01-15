import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityEntityType, ActivityEventType } from '@prisma/client';

type CreateActivityLogInput = {
  organizationId: string;
  actorUserId: string;

  entityType: ActivityEntityType;
  entityId: string;

  eventType: ActivityEventType;

  fromStatus?: string | null;
  toStatus?: string | null;

  toEmail?: string | null;

  meta?: any; // Json
};

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateActivityLogInput) {
    return this.prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        toEmail: input.toEmail ?? null,
        meta: input.meta ?? undefined,
      },
    });
  }

  async list(params: {
    organizationId: string;
    limit?: number;
    cursor?: string | null;
    entityType?: ActivityEntityType;
    eventType?: ActivityEventType;
    entityId?: string;
  }) {
    const {
      organizationId,
      limit = 30,
      cursor,
      entityType,
      eventType,
      entityId,
    } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const take = Math.min(Math.max(limit, 1), 100);

    const items = await this.prisma.activityLog.findMany({
      where: {
        organizationId,
        ...(entityType ? { entityType } : {}),
        ...(eventType ? { eventType } : {}),
        ...(entityId ? { entityId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    const nextCursor =
      items.length === take ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  async latest(params: { organizationId: string; limit?: number }) {
    return this.list({
      organizationId: params.organizationId,
      limit: params.limit ?? 3,
    });
  }
}
