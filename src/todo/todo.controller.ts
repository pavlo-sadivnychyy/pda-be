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
import { TodoStatus } from '@prisma/client';
import { CreateTodoTaskDto, UpdateTodoTaskDto } from './dto/todo-task.dto';

class UpdateTodoStatusDto {
  status: TodoStatus;
}

class AiPlanRequestDto {
  userId: string;
  date: string; // "YYYY-MM-DD"
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

  // PATCH /todo/tasks/:id
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTodoTaskDto) {
    const task = await this.todoService.updateTask(id, dto);
    return { task };
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

  // PATCH /todo/tasks/:id/status
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTodoStatusDto,
  ) {
    if (!dto.status) {
      throw new BadRequestException('status є обовʼязковим');
    }

    const task = await this.todoService.updateTask(id, {
      status: dto.status,
    });
    return { task };
  }

  // DELETE /todo/tasks/:id
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.todoService.deleteTask(id);
    return { success: true };
  }

  // GET /todo/tasks/ai-plan?userId=...&date=YYYY-MM-DD
  @Get('ai-plan')
  async getAiPlan(
    @Query('userId') userId: string,
    @Query('date') date: string,
  ) {
    if (!userId || !date) {
      throw new BadRequestException('userId та date є обовʼязковими');
    }

    const plan = await this.todoService.getOrCreateAiPlan(userId, date);
    return { plan };
  }

  // POST /todo/tasks/ai-plan
  @Post('ai-plan')
  async getOrCreateAiPlan(@Body() body: AiPlanRequestDto) {
    const { userId, date } = body;

    if (!userId || !date) {
      throw new BadRequestException('userId та date є обовʼязковими');
    }

    const plan = await this.todoService.getOrCreateAiPlan(userId, date);
    return { plan };
  }
}
