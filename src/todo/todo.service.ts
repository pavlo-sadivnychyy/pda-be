import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTodoTaskDto, UpdateTodoTaskDto } from './dto/todo-task.dto';
import { TodoTask } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class TodoService {
  constructor(private readonly prisma: PrismaService) {}

  async createTask(userId: string, dto: CreateTodoTaskDto): Promise<TodoTask> {
    const { organizationId, ...rest } = dto;

    return this.prisma.todoTask.create({
      data: {
        ...rest,
        startAt: new Date(dto.startAt),
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        userId,
        organizationId: organizationId ?? null,
      },
    });
  }

  async updateTask(id: string, dto: UpdateTodoTaskDto): Promise<TodoTask> {
    const existing = await this.prisma.todoTask.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const { organizationId, ...rest } = dto;

    return this.prisma.todoTask.update({
      where: { id },
      data: {
        ...rest,
        startAt: dto.startAt ? new Date(dto.startAt) : existing.startAt,
        endAt: dto.endAt ? new Date(dto.endAt) : existing.endAt,
        organizationId:
          organizationId !== undefined
            ? organizationId
            : existing.organizationId,
      },
    });
  }

  async deleteTask(id: string): Promise<void> {
    const existing = await this.prisma.todoTask.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    await this.prisma.todoTask.delete({ where: { id } });
  }

  async getTasksForDay(
    userId: string,
    date: string,
    organizationId?: string,
  ): Promise<TodoTask[]> {
    const d = new Date(date);
    const from = startOfDay(d);
    const to = endOfDay(d);

    return this.prisma.todoTask.findMany({
      where: {
        userId,
        startAt: {
          gte: from,
          lte: to,
        },
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async getTasksForRange(
    userId: string,
    fromStr: string,
    toStr: string,
    organizationId?: string,
  ): Promise<TodoTask[]> {
    const from = new Date(fromStr);
    const to = new Date(toStr);

    return this.prisma.todoTask.findMany({
      where: {
        userId,
        startAt: {
          gte: from,
          lte: to,
        },
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async getTodayTasks(
    userId: string,
    timezone?: string, // на потім, якщо будеш юзати
    organizationId?: string,
  ): Promise<TodoTask[]> {
    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);

    return this.prisma.todoTask.findMany({
      where: {
        userId,
        startAt: {
          gte: from,
          lte: to,
        },
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { startAt: 'asc' },
    });
  }
}
