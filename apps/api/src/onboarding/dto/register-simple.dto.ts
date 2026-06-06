import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { PlanTier } from '@prisma/client';

/** Registo simples: email + palavra-passe própria OU conta Google. */
export class RegisterSimpleDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  /** ID token do Google (alternativa ao email/password). */
  @IsOptional()
  @IsString()
  googleIdToken?: string;

  @IsEnum(PlanTier)
  planTier!: PlanTier;
}

/** Conclusão do setup obrigatório (nome, código, NIF, logo). */
export class CompleteSetupDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'Código: minúsculas, dígitos e hífens.' })
  companyCode!: string;

  @IsString()
  @Matches(/^\d{9,10}$/, { message: 'NIF inválido.' })
  nif!: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}
