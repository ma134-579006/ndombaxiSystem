import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export const AGT_ENVIRONMENTS = ['TEST', 'PRODUCTION'] as const;
export type AgtEnvironment = (typeof AGT_ENVIRONMENTS)[number];

/**
 * Campo fiscal LIVRE configurado pelo Super Admin. Permite acrescentar
 * qualquer exigência futura da AGT (texto, nº, observação) e escolher se
 * aparece nos recibos e/ou nos relatórios — sem alterar o código.
 */
export class AgtExtraFieldDto {
  @IsString()
  @Length(1, 60)
  key!: string;

  @IsString()
  @Length(1, 120)
  label!: string;

  @IsString()
  @Length(0, 500)
  value!: string;

  @IsOptional()
  @IsBoolean()
  showOnReceipt?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnReport?: boolean;
}

/**
 * Configuração fiscal AGT — TODOS os campos opcionais (PATCH parcial). O Super
 * Admin altera apenas o que precisar a partir do painel.
 */
export class UpdateAgtConfigDto {
  @IsOptional()
  @IsIn(AGT_ENVIRONMENTS as unknown as string[])
  environment?: AgtEnvironment;

  /** Nº de validação atribuído pela AGT na certificação do software. */
  @IsOptional()
  @IsString()
  @Length(0, 60)
  softwareCertificateNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  productId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  productVersion?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  sourceId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  taxAccountingBasis?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  taxEntity?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  saftVersion?: string;

  /** Legenda obrigatória no rodapé dos recibos (ex.: "Processado por programa validado nº .../AGT"). */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  receiptLegend?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reportFooter?: string;

  /** Campos fiscais livres (substitui o conjunto inteiro). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgtExtraFieldDto)
  extraFields?: AgtExtraFieldDto[];

  // ── Comunicação eletrónica com a AGT (DP 71/25) — contrato da plataforma ──
  /** Liga/desliga globalmente a comunicação eletrónica (kill switch). */
  @IsOptional()
  @IsBoolean()
  communicationEnabled?: boolean;

  /** URL do serviço web da AGT para submissão de documentos. */
  @IsOptional()
  @IsString()
  @Length(0, 300)
  endpointUrl?: string;

  /** Credencial/token da AGT — texto simples na entrada (cifrado ao guardar).
   *  Enviar string vazia limpa o segredo guardado; omitir mantém o actual. */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  apiKey?: string;
}
