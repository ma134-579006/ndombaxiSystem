import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { PlanTier } from '@prisma/client';

export class RegisterCompanyDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, {
    message: 'companyCode deve conter apenas minúsculas, dígitos e hífens',
  })
  companyCode!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(/^\d{9,10}$/, { message: 'NIF inválido' })
  nif!: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsString()
  @Length(2, 120)
  responsibleName!: string;

  @IsEmail()
  responsibleEmail!: string;

  @IsOptional()
  @IsString()
  responsiblePhone?: string;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsEnum(PlanTier)
  planTier!: PlanTier;
}
