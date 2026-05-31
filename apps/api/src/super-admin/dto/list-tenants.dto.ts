import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CompanyStatus, PlanTier } from '@prisma/client';

export class ListTenantsDto {
  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;

  @IsOptional()
  @IsEnum(PlanTier)
  planTier?: PlanTier;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ChangePlanDto {
  @IsEnum(PlanTier)
  planTier!: PlanTier;
}
