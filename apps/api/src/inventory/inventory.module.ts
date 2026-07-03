import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/** Inventário empresarial — Curva ABC, previsão de reposição/sugestão de
 *  compra, valorização FIFO/LIFO/CMP, motor antifraude, localização física
 *  e transferências com aprovação. Aditivo: assenta no livro de stock e na
 *  auditoria por tenant já existentes. */
@Module({
  imports: [CashboxModule], // TenantAuditService (Prisma/Tenancy são globais)
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
