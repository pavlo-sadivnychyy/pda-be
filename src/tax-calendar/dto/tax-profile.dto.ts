import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { TaxEntityType, TaxJurisdiction } from '@prisma/client';

export class UpsertTaxProfileDto {
  @IsString()
  organizationId: string;

  @IsEnum(TaxJurisdiction)
  jurisdiction: TaxJurisdiction;

  @IsEnum(TaxEntityType)
  entityType: TaxEntityType;

  @IsObject()
  settings: any;

  @IsOptional()
  @IsString()
  timezone?: string;
}
