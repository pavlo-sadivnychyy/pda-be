import {
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
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ExpensePlannerService } from './expense-planner.service';
import {
  CreateExpenseCategoryDto,
  CreateExpenseItemDto,
  CreateExpenseRecurringRuleDto,
  EnsureExpenseMonthDto,
  ListExpenseMonthsQueryDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseItemDto,
  UpdateExpenseMonthDto,
  UpdateExpenseRecurringRuleDto,
} from './expense-planner.dto';

@UseGuards(ClerkAuthGuard)
@Controller('expense-planner')
export class ExpensePlannerController {
  constructor(private readonly expensePlannerService: ExpensePlannerService) {}

  @Post('months/ensure')
  async ensureMonth(@Req() req: any, @Body() dto: EnsureExpenseMonthDto) {
    return this.expensePlannerService.ensureMonth(req.authUserId, dto);
  }

  @Patch('months/:monthKey')
  async updateMonth(
    @Req() req: any,
    @Param('monthKey') monthKey: string,
    @Body() dto: UpdateExpenseMonthDto,
  ) {
    return this.expensePlannerService.updateMonth(
      req.authUserId,
      monthKey,
      dto,
    );
  }

  @Get('months')
  async listMonths(@Req() req: any, @Query() query: ListExpenseMonthsQueryDto) {
    return this.expensePlannerService.listMonths(req.authUserId, query);
  }

  @Get('months/:monthKey')
  async getMonth(@Req() req: any, @Param('monthKey') monthKey: string) {
    return this.expensePlannerService.getMonth(req.authUserId, monthKey);
  }

  @Post('months/:monthKey/generate-recurring')
  async generateRecurring(
    @Req() req: any,
    @Param('monthKey') monthKey: string,
  ) {
    return this.expensePlannerService.generateRecurringForMonth(
      req.authUserId,
      monthKey,
    );
  }

  @Post('categories')
  async createCategory(@Req() req: any, @Body() dto: CreateExpenseCategoryDto) {
    return this.expensePlannerService.createCategory(req.authUserId, dto);
  }

  @Patch('categories/:id')
  async updateCategory(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.expensePlannerService.updateCategory(req.authUserId, id, dto);
  }

  @Delete('categories/:id')
  async deleteCategory(@Req() req: any, @Param('id') id: string) {
    return this.expensePlannerService.deleteCategory(req.authUserId, id);
  }

  @Post('items')
  async createItem(@Req() req: any, @Body() dto: CreateExpenseItemDto) {
    return this.expensePlannerService.createItem(req.authUserId, dto);
  }

  @Patch('items/:id')
  async updateItem(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseItemDto,
  ) {
    return this.expensePlannerService.updateItem(req.authUserId, id, dto);
  }

  @Delete('items/:id')
  async deleteItem(@Req() req: any, @Param('id') id: string) {
    return this.expensePlannerService.deleteItem(req.authUserId, id);
  }

  @Post('recurring-rules')
  async createRecurringRule(
    @Req() req: any,
    @Body() dto: CreateExpenseRecurringRuleDto,
  ) {
    return this.expensePlannerService.createRecurringRule(req.authUserId, dto);
  }

  @Patch('recurring-rules/:id')
  async updateRecurringRule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseRecurringRuleDto,
  ) {
    return this.expensePlannerService.updateRecurringRule(
      req.authUserId,
      id,
      dto,
    );
  }

  @Delete('recurring-rules/:id')
  async deleteRecurringRule(@Req() req: any, @Param('id') id: string) {
    return this.expensePlannerService.deleteRecurringRule(req.authUserId, id);
  }
}
