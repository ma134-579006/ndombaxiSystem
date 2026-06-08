import { Module } from '@nestjs/common';
import { FiscalModule } from '../fiscal/fiscal.module';
import { CashboxModule } from '../cashbox/cashbox.module';
import { PosController } from './pos.controller';
import { PosRepository } from './pos.repository';
import { InvoiceService } from './invoice.service';
import { FiscalSigningService } from './fiscal-signing.service';
import { SaftService } from './saft.service';
import { PlanLimitsService } from '../plans/plan-limits.service';

@Module({
  imports: [FiscalModule, CashboxModule],
  controllers: [PosController],
  providers: [PosRepository, InvoiceService, FiscalSigningService, SaftService, PlanLimitsService],
  exports: [PosRepository, InvoiceService, FiscalSigningService, SaftService],
})
export class PosModule {}
