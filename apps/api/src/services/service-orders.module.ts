import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';

/** Serviços — Ordens de Serviço. PrismaService/TenantContext globais. */
@Module({
  imports: [PosModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService],
  exports: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
