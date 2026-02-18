import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRecurringProfileDto {
  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsString()
  templateInvoiceId!: string;

  // DAY | WEEK | MONTH | YEAR
  @IsIn(['DAY', 'WEEK', 'MONTH', 'YEAR'])
  intervalUnit!: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalCount?: number;

  @IsDateString()
  startAt!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dueDays?: number;

  @IsOptional()
  @IsBoolean()
  autoSendEmail?: boolean;

  // ua | international
  @IsOptional()
  @IsIn(['ua', 'international'])
  variant?: 'ua' | 'international';
}
