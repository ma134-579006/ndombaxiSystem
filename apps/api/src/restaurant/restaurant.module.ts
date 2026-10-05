import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { PosModule } from '../pos/pos.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';

/** Restauração — mesas, comandas, cozinha e PRODUÇÃO (fornadas).
 *  PrismaService/TenantContext globais; CashboxModule dá o TenantAuditService. */
@Module({
  imports: [CashboxModule, PosModule],
  controllers: [RestaurantController],
  providers: [RestaurantService],
  exports: [RestaurantService],
})
export class RestaurantModule {}
