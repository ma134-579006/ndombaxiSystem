import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
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

/** Bónus / reativação: dias e/ou meses a estender à validade do plano. */
export class GrantBonusDto {
  @IsOptional() @IsInt() @Min(0) @Max(3650) days?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) months?: number;
  @IsOptional() @IsString() @Length(0, 200) note?: string;
}
