import { Module } from '@nestjs/common';
import { FiscalModule } from '../fiscal/fiscal.module';
import { CashboxModule } from '../cashbox/cashbox.module';
import { PosController } from './pos.controller';
import { PosRepository } from './pos.repository';
import { InvoiceService } from './invoice.service';
import { FiscalSigningService } from './fiscal-signing.service';
import { SaftService } from './saft.service';
import { PlanLimitsService } from '../plans/plan-limits.service';
import { DevicesModule } from '../devices/devices.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PasswordService } from '../auth/password.service';
import { DiscountGuardService } from './discount-guard.service';

@Module({
  imports: [FiscalModule, CashboxModule, DevicesModule, PromotionsModule],
  controllers: [PosController],
  providers: [PosRepository, InvoiceService, FiscalSigningService, SaftService, PlanLimitsService, PasswordService, DiscountGuardService],
  exports: [PosRepository, InvoiceService, FiscalSigningService, SaftService],
})
export class PosModule {}
