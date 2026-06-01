import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';

export const GATEWAY_PROVIDERS = ['EXPRESS', 'EMIS', 'PROXYPAY', 'REFERENCE', 'GENERIC'] as const;
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

  /** Credencial/segredo do contrato (API key da EMIS/Express); encriptada. */
  @IsOptional()
  @IsString()
  apiKey?: string;

  // ── Pagamento por REFERÊNCIA (contrato EMIS) ───────────────
  /** Entidade EMIS (5 dígitos) atribuída pelo contrato. */
  @IsOptional()
  @IsString()
  @Length(5, 5)
  referenceEntity?: string;

  /** Ambiente do contrato: TEST | PRODUCTION. */
  @IsOptional()
  @IsIn(['TEST', 'PRODUCTION'])
  environment?: 'TEST' | 'PRODUCTION';

  /** Validade por omissão de cada referência (dias). */
  @IsOptional()
  @IsInt()
  @Min(1)
  validityDays?: number;

  /** URL de callback para a EMIS confirmar o pagamento. */
  @IsOptional()
  @IsString()
  callbackUrl?: string;

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
  @IsString()
  @Length(5, 5)
  referenceEntity?: string;

  @IsOptional()
  @IsIn(['TEST', 'PRODUCTION'])
  environment?: 'TEST' | 'PRODUCTION';

  @IsOptional()
  @IsInt()
  @Min(1)
  validityDays?: number;

  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
