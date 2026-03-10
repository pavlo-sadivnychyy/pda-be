import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum ExpenseItemTypeDto {
  PLANNED = 'PLANNED',
  ACTUAL = 'ACTUAL',
}

export class EnsureExpenseMonthDto {
  @Matches(/^\d{4}-\d{2}$/)
  monthKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;
}

export class UpdateExpenseMonthDto {
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  incomePlanned?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  incomeActual?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateExpenseCategoryDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @IsOptional()
  @IsString()
  planId?: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateExpenseItemDto {
  @IsString()
  planId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorName?: string;

  @IsEnum(ExpenseItemTypeDto)
  type!: ExpenseItemTypeDto;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  amountPlanned?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  amountActual?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expenseDate!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidAt?: string;
}

export class UpdateExpenseItemDto {
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorName?: string;

  @IsOptional()
  @IsEnum(ExpenseItemTypeDto)
  type?: ExpenseItemTypeDto;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  amountPlanned?: number | null;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  amountActual?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expenseDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidAt?: string | null;
}

export class CreateExpenseRecurringRuleDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorName?: string;

  @Type(() => Number)
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth!: number;

  @Matches(/^\d{4}-\d{2}$/)
  startMonthKey!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  endMonthKey?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateExpenseRecurringRuleDto {
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorName?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  startMonthKey?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  endMonthKey?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListExpenseMonthsQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  to?: string;
}
