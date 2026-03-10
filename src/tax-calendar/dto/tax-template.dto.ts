import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TaxEventKind } from '@prisma/client';

export class CreateTaxTemplateDto {
  @IsString()
  organizationId: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(TaxEventKind)
  kind: TaxEventKind;

  @IsString()
  rrule: string;

  @IsInt()
  @Min(0)
  dueOffsetDays: number;

  @IsOptional()
  @IsString()
  dueTimeLocal?: string; // "18:00"

  @IsOptional()
  @IsObject()
  rule?: any;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTaxTemplateDto {
  @IsString()
  id: string;

  @IsString()
  organizationId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaxEventKind)
  kind?: TaxEventKind;

  @IsOptional()
  @IsString()
  rrule?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dueOffsetDays?: number;

  @IsOptional()
  @IsString()
  dueTimeLocal?: string;

  @IsOptional()
  @IsObject()
  rule?: any;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
