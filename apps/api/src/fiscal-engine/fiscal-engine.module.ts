import { Global, Module } from '@nestjs/common';
import { FiscalEngineAdminController, FiscalEngineTenantController } from './fiscal-engine.controller';
import { FiscalEngineService } from './fiscal-engine.service';

/** Motor fiscal (LPS / Cegid Vendus / suspenso). Global: o POS e a landing consultam-no. */
@Global()
@Module({
  controllers: [FiscalEngineAdminController, FiscalEngineTenantController],
  providers: [FiscalEngineService],
  exports: [FiscalEngineService],
})
export class FiscalEngineModule {}
