import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { CommissionsService } from './commissions.service';
import { CommissionsController } from './commissions.controller';

/** Comissões de vendedores (RH/vendas). */
@Module({
  imports: [CashboxModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule {}
