import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { PlanTier } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsAngolaIban } from '../../common/validation/angola';
import { NIF_MESSAGE, NIF_REGEX, normalizeNif } from '../nif.service';

export class RegisterCompanyDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, {
    message: 'companyCode deve conter apenas minúsculas, dígitos e hífens',
  })
  companyCode!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @Transform(({ value }) => normalizeNif(value))
  @IsString()
  @Matches(NIF_REGEX, { message: NIF_MESSAGE })
  nif!: string;

  @IsOptional()
  @IsString()
  @IsAngolaIban()
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
