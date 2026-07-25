import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { PushService } from './push.service';

/**
 * Módulo de sincronização Offline-First.
 *
 * Importa o `PosModule` de propósito: a emissão fiscal continua a pertencer ao
 * `InvoiceService`. Este módulo é uma porta de entrada para operações feitas
 * sem rede — não uma segunda implementação das regras de negócio.
 */
@Module({
  imports: [PosModule],
  controllers: [SyncController],
  providers: [SyncService, PushService],
  exports: [SyncService],
})
export class SyncModule {}
