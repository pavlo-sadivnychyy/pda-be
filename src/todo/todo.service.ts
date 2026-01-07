import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTodoTaskDto, UpdateTodoTaskDto } from './dto/todo-task.dto';
import { TodoTask, TodoStatus } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';
import OpenAI from 'openai';

export type AiPlanTimelineItem = {
  time: string; // "HH:mm"
  taskId: string | null;
  title: string;
  statusSuggestion?: TodoStatus;
  note?: string;
};

export type AiPlan = {
  summary: string;
  suggestions: string[];
  timeline: AiPlanTimelineItem[];
};

@Injectable()
export class TodoService {
  private readonly openai: OpenAI;

  constructor(private readonly prisma: PrismaService) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // --- CRUD ---

  async createTask(dto: CreateTodoTaskDto): Promise<TodoTask> {
    const { organizationId, startAt, endAt, userId, ...rest } = dto;

    return this.prisma.todoTask.create({
      data: {
        ...rest,
        userId,
        organizationId: organizationId ?? null,
        startAt: new Date(startAt),
        endAt: endAt ? new Date(endAt) : null,
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

    const { organizationId, startAt, endAt, ...rest } = dto;

    return this.prisma.todoTask.update({
      where: { id },
      data: {
        ...rest,
        startAt: startAt ? new Date(startAt) : existing.startAt,
        endAt: endAt ? new Date(endAt) : existing.endAt,
        organizationId:
          organizationId !== undefined
            ? organizationId
            : existing.organizationId,
      },
    });
  }

  async updateTaskStatus(id: string, status: TodoStatus): Promise<TodoTask> {
    const existing = await this.prisma.todoTask.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    return this.prisma.todoTask.update({
      where: { id },
      data: { status },
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

  // --- queries по датах ---

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
    timezone?: string,
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

  // --- AI planner ---

  async generateAiPlan(userId: string, dateStr: string): Promise<AiPlan> {
    const tasks = await this.getTasksForDay(userId, dateStr);

    const payload = {
      date: dateStr,
      nowIso: new Date().toISOString(),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        startAt: t.startAt.toISOString(),
        status: t.status,
        priority: t.priority,
      })),
    };

    const systemPrompt = `
Ти особистий асистент з продуктивності.
У тебе є список задач користувача на конкретний день (із часом, пріоритетом та статусом).
Твоє завдання:
1) Запропонувати оптимальний порядок дня (що робити по черзі) з урахуванням поточного часу.
2) Підказати, які задачі варто виконати, які перенести, які можна скасувати.
3) Дати кілька загальних порад (2–5 пунктів).
ПОВЕРТАЙ ТІЛЬКИ валідний JSON, без пояснень навколо.

Формат JSON:
{
  "summary": "короткий опис дня українською",
  "suggestions": ["рядок поради 1", "рядок поради 2"],
  "timeline": [
    {
      "time": "HH:mm",
      "taskId": "id задачі або null",
      "title": "що робити в цей час",
      "statusSuggestion": "PENDING | IN_PROGRESS | DONE | CANCELLED",
      "note": "коментар (опційно)"
    }
  ]
}
    `.trim();

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty AI response for plan');
    }

    const parsed = JSON.parse(content) as AiPlan;
    return parsed;
  }
}
