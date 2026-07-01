import { IsIn, IsOptional, IsString } from 'class-validator';

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
}
