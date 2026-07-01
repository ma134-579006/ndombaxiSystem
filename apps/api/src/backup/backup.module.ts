import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupSchedulerService } from './backup-scheduler.service';

/** Backup & Restauro dos dados de gestão — manual, automático (agendado) e
 *  restauro por upsert (nunca destrutivo). Ver DP 71/25 (imutabilidade fiscal
 *  já cobre facturas; este módulo cobre o resto dos dados de gestão). */
@Module({
  imports: [CashboxModule],
  controllers: [BackupController],
  providers: [BackupService, BackupSchedulerService],
  exports: [BackupService],
})
export class BackupModule {}
