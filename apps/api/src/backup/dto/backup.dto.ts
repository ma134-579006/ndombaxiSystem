import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export const BACKUP_FREQUENCIES = ['DAILY', 'WEEKLY'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

/** Configuração do backup automático (agendado) — por empresa. */
export class UpdateBackupSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoEnabled?: boolean;

  @IsOptional()
  @IsIn(BACKUP_FREQUENCIES as unknown as string[])
  frequency?: BackupFrequency;
}

/** Conteúdo de um backup (próprio formato Ndombaxi) para pré-visualizar/restaurar. */
export class RestoreBackupDto {
  /** Conteúdo do ficheiro .ndbak (gzip+base64) tal como foi descarregado. */
  @IsString()
  contentBase64!: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  /** Loja para onde vai o stock cuja loja de origem (no backup) já não existe
   *  neste tenant. Omisso/null = essas linhas de stock ficam por conta do
   *  próprio restauro (falham isoladamente, sem afectar as restantes). */
  @IsOptional()
  @IsString()
  storeId?: string | null;
}
