import { IsEmail, IsOptional } from 'class-validator';

/** Forçar reset de senha de um utilizador de uma empresa (§2.2). */
export class ResetTenantPasswordDto {
  /** E-mail do utilizador a repor. Se omitido, repõe o responsável da empresa. */
  @IsOptional()
  @IsEmail()
  email?: string;
}
