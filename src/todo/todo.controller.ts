import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
} from '@nestjs/common';
import { TodoService } from './todo.service';
import { CreateTodoTaskDto, UpdateTodoTaskDto } from './dto/todo-task.dto';
import { TodoStatus } from '@prisma/client';

class UpdateTodoStatusDto {
  status: TodoStatus;
}

class AiPlanRequestDto {
  userId: string;
  /** YYYY-MM-DD, якщо не передати — візьмемо сьогодні */
  date?: string;
}

@Controller('todo/tasks')
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  // POST /todo/tasks
  @Post()
  async create(@Body() dto: CreateTodoTaskDto) {
    if (!dto.userId || !dto.title || !dto.startAt) {
      throw new BadRequestException('userId, title та startAt є обовʼязковими');
    }

    const task = await this.todoService.createTask(dto);
    return { task };
  }

  // PATCH /todo/tasks/:id  (оновлення будь-яких полів)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTodoTaskDto) {
    const task = await this.todoService.updateTask(id, dto);
    return { task };
  }

  // PATCH /todo/tasks/:id/status  (зміна тільки статусу)
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTodoStatusDto,
  ) {
    if (!dto.status) {
      throw new BadRequestException('status є обовʼязковим');
    }
    const task = await this.todoService.updateTaskStatus(id, dto.status);
    return { task };
  }

  // DELETE /todo/tasks/:id
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.todoService.deleteTask(id);
    return { success: true };
  }

  // GET /todo/tasks/today?userId=...
  @Get('today')
  async getToday(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId є обовʼязковим');
    }
    const items = await this.todoService.getTodayTasks(userId);
    return { items };
  }

  // GET /todo/tasks/day?userId=...&date=YYYY-MM-DD
  @Get('day')
  async getForDay(
    @Query('userId') userId: string,
    @Query('date') date: string,
  ) {
    if (!userId || !date) {
      throw new BadRequestException('userId та date є обовʼязковими');
    }
    const items = await this.todoService.getTasksForDay(userId, date);
    return { items };
  }

  // GET /todo/tasks/range?userId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
  @Get('range')
  async getForRange(
    @Query('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!userId || !from || !to) {
      throw new BadRequestException('userId, from та to є обовʼязковими');
    }
    const items = await this.todoService.getTasksForRange(userId, from, to);
    return { items };
  }

  // POST /todo/tasks/ai-plan
  @Post('ai-plan')
  async getAiPlan(@Body() dto: AiPlanRequestDto) {
    if (!dto.userId) {
      throw new BadRequestException('userId є обовʼязковим');
    }

    const date = dto.date ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const plan = await this.todoService.generateAiPlan(dto.userId, date);
    return { plan };
  }
}
