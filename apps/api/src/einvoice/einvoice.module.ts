import { Global, Module } from '@nestjs/common';
import { EinvoiceAdminController, EinvoiceTenantController } from './einvoice.controller';
import { EinvoiceService } from './einvoice.service';

@Global()
@Module({
  controllers: [EinvoiceAdminController, EinvoiceTenantController],
  providers: [EinvoiceService],
  exports: [EinvoiceService],
})
export class EinvoiceModule {}
