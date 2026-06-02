import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { ReceivablesService } from './receivables.service';
import { ReceivablesController } from './receivables.controller';

/** Contas a receber (venda a crédito / fiado). */
@Module({
  imports: [CashboxModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
