import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export enum ClientCrmStatus {
  LEAD = 'LEAD',
  IN_PROGRESS = 'IN_PROGRESS',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class CreateClientDto {
  @IsString()
  organizationId: string;

  // ⚠️ залишаю поле, щоб не ламати старі фронтові запити
  // але в service воно ігнорується (захист від підміни)
  @IsOptional()
  @IsString()
  createdById?: string;

  @IsString()
  @MaxLength(200)
  name: string; // назва компанії або ПІБ

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // ✅ NEW
  @IsOptional()
  @IsEnum(ClientCrmStatus)
  crmStatus?: ClientCrmStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}
