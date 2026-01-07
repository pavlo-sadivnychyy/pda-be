import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TodoService } from './todo.service';
import { CreateTodoTaskDto, UpdateTodoTaskDto } from './dto/todo-task.dto';

@Controller('todo/tasks')
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  // POST /todo/tasks
  @Post()
  async create(
    @Body()
    body: CreateTodoTaskDto & { userId?: string },
  ) {
    const { userId, ...dto } = body;

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const task = await this.todoService.createTask(userId, dto);
    return { task };
  }

  // PATCH /todo/tasks/:id
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTodoTaskDto) {
    const task = await this.todoService.updateTask(id, dto);
    return { task };
  }

  // DELETE /todo/tasks/:id
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.todoService.deleteTask(id);
    return { success: true };
  }

  // GET /todo/tasks/today?userId=...&organizationId=...
  @Get('today')
  async getToday(
    @Query('userId') userId?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }

    const items = await this.todoService.getTodayTasks(
      userId,
      undefined,
      organizationId || undefined,
    );

    return { items };
  }

  // GET /todo/tasks/day?userId=...&date=2026-01-07&organizationId=...
  @Get('day')
  async getForDay(
    @Query('userId') userId?: string,
    @Query('date') date?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    if (!date) {
      throw new BadRequestException('date query param is required');
    }

    const items = await this.todoService.getTasksForDay(
      userId,
      date,
      organizationId || undefined,
    );

    return { items };
  }

  // GET /todo/tasks/range?userId=...&from=2026-01-01&to=2026-01-31&organizationId=...
  @Get('range')
  async getForRange(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    if (!from || !to) {
      throw new BadRequestException('from and to query params are required');
    }

    const items = await this.todoService.getTasksForRange(
      userId,
      from,
      to,
      organizationId || undefined,
    );

    return { items };
  }
}
