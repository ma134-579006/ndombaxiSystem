import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';

/** Restauração — mesas, comandas, cozinha e PRODUÇÃO (fornadas).
 *  PrismaService/TenantContext globais; CashboxModule dá o TenantAuditService. */
@Module({
  imports: [CashboxModule],
  controllers: [RestaurantController],
  providers: [RestaurantService],
  exports: [RestaurantService],
})
export class RestaurantModule {}
