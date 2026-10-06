import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';

export const MIGRATION_KINDS = ['products', 'customers', 'suppliers'] as const;
export type MigrationKind = (typeof MIGRATION_KINDS)[number];

/** Importação de dados de outro sistema (Vendus, Primavera, Negócio, etc.) — o
 *  ficheiro chega como base64 (mesma convenção já usada para imagens/comprovativos). */
export class MigrationFileDto {
  @IsIn(MIGRATION_KINDS as unknown as string[])
  kind!: MigrationKind;

  @IsString()
  contentBase64!: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  /** Só relevante para produtos: loja específica onde o stock importado entra
   *  (fica "por loja"). Omisso/null = "Todas as lojas" (stock partilhado). */
  @IsOptional()
  @IsString()
  storeId?: string | null;

  /** Só produtos: escolha manual das colunas do ficheiro (campo → cabeçalho; vazio = não usar). */
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  /** Só produtos: IVA a aplicar aos produtos do ficheiro (omisso = IVA normal, como antes). */
  @IsOptional()
  @IsIn(['NOR', 'INT', 'RED', 'ISE', 'OUT'])
  ivaCode?: 'NOR' | 'INT' | 'RED' | 'ISE' | 'OUT';

  /** Só produtos isentos: código de isenção AGT (M10, M11…). */
  @IsOptional()
  @IsString()
  @Matches(/^M\d{2}$/)
  exemptionCode?: string;

  /** Só produtos: os preços de venda do ficheiro já incluem IVA (PVP)? */
  @IsOptional()
  @IsBoolean()
  pricesIncludeIva?: boolean;
}

/** Opções de IVA da importação de produtos. */
export interface MigrationTaxOptions {
  ivaCode: 'NOR' | 'INT' | 'RED' | 'ISE' | 'OUT';
  exemptionCode?: string | null;
  pricesIncludeIva: boolean;
}
