import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';

export const GATEWAY_PROVIDERS = ['EXPRESS', 'EMIS', 'PROXYPAY', 'GENERIC'] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

/**
 * Contrato de gateway de pagamento ao nível da plataforma (§ Fase 8).
 * Ex.: Multicaixa Express — configurado pelo Super Admin com IBAN e
 * credenciais (encriptadas em repouso).
 */
export class CreateGatewayDto {
  @IsIn(GATEWAY_PROVIDERS as unknown as string[])
  provider!: GatewayProvider;

  @IsString()
  @Length(1, 160)
  label!: string;

  @IsOptional()
  @IsString()
  contractRef?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  posId?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  /** Credencial/segredo do contrato; guardada encriptada. */
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateGatewayDto {
  @IsOptional()
  @IsIn(GATEWAY_PROVIDERS as unknown as string[])
  provider?: GatewayProvider;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  label?: string;

  @IsOptional()
  @IsString()
  contractRef?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  posId?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
