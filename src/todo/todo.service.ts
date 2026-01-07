import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TodoTask, TodoStatus, TodoDailyPlan } from '@prisma/client';
import { CreateTodoTaskDto, UpdateTodoTaskDto } from './dto/todo-task.dto';
import { startOfDay, endOfDay } from 'date-fns';
import OpenAI from 'openai';

@Injectable()
export class TodoService {
  private openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  constructor(private readonly prisma: PrismaService) {}

  // ---------- BASIC TASK CRUD ----------

  async createTask(dto: CreateTodoTaskDto): Promise<TodoTask> {
    const { organizationId, userId, ...rest } = dto;

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

  // ---------- AI DAILY PLAN (1 per day per user) ----------

  async getOrCreateAiPlan(
    userId: string,
    date: string, // "YYYY-MM-DD"
  ): Promise<TodoDailyPlan> {
    // 1. шукаємо існуючий план
    const existing = await this.prisma.todoDailyPlan.findFirst({
      where: {
        userId,
        date,
      },
    });

    if (existing) {
      return existing;
    }

    // 2. тягнемо задачі на цей день
    const tasks = await this.getTasksForDay(userId, date);

    // 3. генеруємо план через OpenAI
    const plan = await this.generateAiPlanFromTasks(tasks, date);

    // 4. зберігаємо в БД
    return this.prisma.todoDailyPlan.create({
      data: {
        userId,
        date,
        summary: plan.summary,
        suggestions: plan.suggestions,
        timeline: plan.timeline,
      },
    });
  }

  private async generateAiPlanFromTasks(
    tasks: TodoTask[],
    date: string,
  ): Promise<{
    summary: string;
    suggestions: string[];
    timeline: { time: string; task: string; status: TodoStatus }[];
  }> {
    // якщо задач немає – дефолт без OpenAI
    if (!tasks || tasks.length === 0) {
      return {
        summary:
          'На сьогодні у тебе немає запланованих задач. Використай цей день для відпочинку, навчання або стратегічного планування.',
        suggestions: [
          'Подумай, що може покращити твій бізнес/роботу в довгостроковій перспективі.',
          'Переглянь старі нотатки або ідеї, які ти давно відкладаєш.',
        ],
        timeline: [],
      };
    }

    const systemPrompt = `
Ти асистент-планувальник. Отримуєш список задач користувача на день (з часом, пріоритетами та статусами) 
і маєш скласти структурований план дня.

Відповідай строго у JSON у форматі:
{
  "summary": "короткий підсумок дня",
  "suggestions": ["порада №1", "порада №2"],
  "timeline": [
    { "time": "09:00", "task": "Що робити", "status": "PENDING" }
  ]
}

status у timeline повинен бути одним із: "PENDING", "IN_PROGRESS", "DONE", "CANCELLED".
`;

    const userContent = {
      date,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        startAt: t.startAt,
        priority: t.priority,
        status: t.status,
      })),
    };

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify(userContent),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content || '{}';

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary
        : 'AI-план на сьогодні готовий. Зосередься на ключових задачах з високим пріоритетом.';

    const suggestions =
      Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0
        ? parsed.suggestions.map((s: any) => String(s))
        : [
            'Почни день із задач з високим пріоритетом.',
            'Закладай буфер часу між задачами, щоб уникати стресу.',
          ];

    const timelineRaw = Array.isArray(parsed.timeline) ? parsed.timeline : [];

    const timeline = timelineRaw
      .map((item: any) => {
        const time = typeof item.time === 'string' ? item.time : null;
        const task = typeof item.task === 'string' ? item.task : null;
        const statusVal =
          item.status && typeof item.status === 'string'
            ? item.status.toUpperCase()
            : 'PENDING';

        if (!time || !task) return null;

        const status: TodoStatus =
          statusVal === 'DONE' ||
          statusVal === 'IN_PROGRESS' ||
          statusVal === 'CANCELLED' ||
          statusVal === 'PENDING'
            ? (statusVal as TodoStatus)
            : 'PENDING';

        return { time, task, status };
      })
      .filter(Boolean);

    return {
      summary,
      suggestions,
      timeline,
    };
  }
}
