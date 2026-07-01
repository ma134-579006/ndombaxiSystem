import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';

const CHECK_EVERY_MS = 60 * 60 * 1000; // verifica de hora a hora
const FREQ_MS: Record<string, number> = { DAILY: 24 * 60 * 60 * 1000, WEEKLY: 7 * 24 * 60 * 60 * 1000 };

/**
 * Backup automático (agendado): de hora a hora, verifica todas as empresas com
 * `backup_auto_enabled = TRUE` e faz um backup se já passou a frequência
 * escolhida (diário/semanal) desde o último. Uma falha numa empresa nunca
 * impede as restantes (mesmo padrão do `migrateAllTenants`).
 */
@Injectable()
export class BackupSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackupSchedulerService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupService,
  ) {}

  private async listTenantSchemas(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ schema_name: string }[]>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`,
    );
    return rows.map((r) => r.schema_name);
  }

  async runDueBackups(): Promise<void> {
    let schemas: string[];
    try { schemas = await this.listTenantSchemas(); }
    catch (err) { this.logger.warn(`Não consegui listar tenants p/ backup automático: ${err instanceof Error ? err.message : 'erro'}`); return; }

    let ran = 0;
    for (const schema of schemas) {
      try {
        const settings = await this.backups.getSettings(schema);
        if (!settings.autoEnabled) continue;
        const dueMs = FREQ_MS[settings.frequency] ?? FREQ_MS.DAILY;
        const last = settings.lastAt ? new Date(settings.lastAt).getTime() : 0;
        if (Date.now() - last < dueMs) continue;
        await this.backups.create(schema, { id: null, name: 'Backup automático' }, 'AUTO');
        ran += 1;
      } catch (err) {
        this.logger.warn(`Backup automático falhou em ${schema}: ${err instanceof Error ? err.message : 'erro'}`);
      }
    }
    if (ran > 0) this.logger.log(`Backup automático: ${ran} empresa(s) processada(s).`);
  }

  onApplicationBootstrap(): void {
    setTimeout(() => { void this.runDueBackups(); }, 20_000); // após o arranque estabilizar
    setInterval(() => { void this.runDueBackups(); }, CHECK_EVERY_MS);
  }
}
