import { Module } from '@nestjs/common';
import { ErpController } from './erp.controller';
import { ErpRepository } from './erp.repository';
import { StockService } from './stock.service';
import { PurchasingService } from './purchasing.service';

@Module({
  controllers: [ErpController],
  providers: [ErpRepository, StockService, PurchasingService],
  exports: [ErpRepository, StockService, PurchasingService],
})
export class ErpModule {}
