import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ListTaxEventsQueryDto {
  @IsString()
  organizationId: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class MarkTaxEventDto {
  @IsString()
  organizationId: string;

  @IsOptional()
  @IsString()
  note?: string;
}
