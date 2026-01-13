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
  Req,
  UseGuards,
} from '@nestjs/common';
import { TodoService } from './todo.service';
import { TodoStatus } from '@prisma/client';
import { CreateTodoTaskDto, UpdateTodoTaskDto } from './dto/todo-task.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

class UpdateTodoStatusDto {
  status: TodoStatus;
}

class AiPlanRequestDto {
  date: string; // "YYYY-MM-DD"
}

@UseGuards(ClerkAuthGuard)
@Controller('todo/tasks')
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  // POST /todo/tasks
  @Post()
  async create(@Req() req: any, @Body() dto: CreateTodoTaskDto) {
    const authUserId = req.authUserId as string;

    if (!dto.title || !dto.startAt) {
      throw new BadRequestException('title та startAt є обовʼязковими');
    }

    const task = await this.todoService.createTask(authUserId, dto);
    return { task };
  }

  // PATCH /todo/tasks/:id
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTodoTaskDto,
  ) {
    const authUserId = req.authUserId as string;
    const task = await this.todoService.updateTask(authUserId, id, dto);
    return { task };
  }

  // GET /todo/tasks/today?organizationId=...
  @Get('today')
  async getToday(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
  ) {
    const authUserId = req.authUserId as string;
    const items = await this.todoService.getTodayTasks(
      authUserId,
      organizationId,
    );
    return { items };
  }

  // GET /todo/tasks/day?date=YYYY-MM-DD&organizationId=...
  @Get('day')
  async getForDay(
    @Req() req: any,
    @Query('date') date: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const authUserId = req.authUserId as string;

    if (!date) {
      throw new BadRequestException('date є обовʼязковим');
    }

    const items = await this.todoService.getTasksForDay(
      authUserId,
      date,
      organizationId,
    );
    return { items };
  }

  // GET /todo/tasks/range?from=YYYY-MM-DD&to=YYYY-MM-DD&organizationId=...
  @Get('range')
  async getForRange(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const authUserId = req.authUserId as string;

    if (!from || !to) {
      throw new BadRequestException('from та to є обовʼязковими');
    }

    const items = await this.todoService.getTasksForRange(
      authUserId,
      from,
      to,
      organizationId,
    );
    return { items };
  }

  // PATCH /todo/tasks/:id/status
  @Patch(':id/status')
  async updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTodoStatusDto,
  ) {
    const authUserId = req.authUserId as string;

    if (!dto.status) {
      throw new BadRequestException('status є обовʼязковим');
    }

    const task = await this.todoService.updateTask(authUserId, id, {
      status: dto.status,
    });
    return { task };
  }

  // DELETE /todo/tasks/:id
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const authUserId = req.authUserId as string;
    await this.todoService.deleteTask(authUserId, id);
    return { success: true };
  }

  // GET /todo/tasks/ai-plan?date=YYYY-MM-DD
  @Get('ai-plan')
  async getAiPlan(@Req() req: any, @Query('date') date: string) {
    const authUserId = req.authUserId as string;

    if (!date) {
      throw new BadRequestException('date є обовʼязковим');
    }

    const plan = await this.todoService.getOrCreateAiPlan(authUserId, date);
    return { plan };
  }

  // POST /todo/tasks/ai-plan
  @Post('ai-plan')
  async getOrCreateAiPlan(@Req() req: any, @Body() body: AiPlanRequestDto) {
    const authUserId = req.authUserId as string;
    const { date } = body;

    if (!date) {
      throw new BadRequestException('date є обовʼязковим');
    }

    const plan = await this.todoService.getOrCreateAiPlan(authUserId, date);
    return { plan };
  }
}
