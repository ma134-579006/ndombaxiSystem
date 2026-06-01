import { Module } from '@nestjs/common';
import { CashboxService } from './cashbox.service';
import { InventoryService } from './inventory.service';
import { TenantAuditService } from './tenant-audit.service';
import { AlertsService } from './alerts.service';
import {
  AlertsController,
  CashboxController,
  InventoryController,
  TenantAuditController,
} from './cashbox.controller';

/**
 * Caixa por turnos, inventário e auditoria do tenant. O TenantAuditService é
 * exportado para o POS (invoice.service) registar as vendas na auditoria e nos
 * movimentos de caixa.
 */
@Module({
  controllers: [CashboxController, InventoryController, TenantAuditController, AlertsController],
  providers: [CashboxService, InventoryService, TenantAuditService, AlertsService],
  exports: [TenantAuditService, CashboxService],
})
export class CashboxModule {}
