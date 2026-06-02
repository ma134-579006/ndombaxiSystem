import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { PayablesService } from './payables.service';
import { PayablesController } from './payables.controller';

/** Contas a pagar (fornecedores). */
@Module({
  imports: [CashboxModule],
  controllers: [PayablesController],
  providers: [PayablesService],
  exports: [PayablesService],
})
export class PayablesModule {}
