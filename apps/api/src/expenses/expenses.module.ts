import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';

/** Despesas operacionais do gestor (base do lucro líquido). */
@Module({
  imports: [CashboxModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
