import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateRecurringProfileDto {
  @IsOptional()
  @IsString()
  clientId?: string | null;

  @IsOptional()
  @IsString()
  templateInvoiceId?: string;

  @IsOptional()
  @IsIn(['DAY', 'WEEK', 'MONTH', 'YEAR'])
  intervalUnit?: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalCount?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  nextRunAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dueDays?: number;

  @IsOptional()
  @IsBoolean()
  autoSendEmail?: boolean;

  @IsOptional()
  @IsIn(['ua', 'international'])
  variant?: 'ua' | 'international';

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED', 'CANCELLED'])
  status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
}
