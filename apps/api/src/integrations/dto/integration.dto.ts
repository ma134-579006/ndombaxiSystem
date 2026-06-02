import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateIntegrationDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['TEST', 'PRODUCTION'])
  environment?: 'TEST' | 'PRODUCTION';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  /** Segredo/credencial. Se vazio/omitido, mantém o existente. */
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  secret?: string;
}
