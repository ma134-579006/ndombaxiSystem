import { Module } from '@nestjs/common';
import { CashflowService } from './cashflow.service';
import { CashflowController } from './cashflow.controller';

/** Fluxo de caixa + previsão (painel financeiro do gestor). */
@Module({
  controllers: [CashflowController],
  providers: [CashflowService],
  exports: [CashflowService],
})
export class CashflowModule {}
