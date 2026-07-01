import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { ErpModule } from '../erp/erp.module';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';

@Module({
  imports: [CashboxModule, ErpModule],
  controllers: [MigrationController],
  providers: [MigrationService],
})
export class MigrationModule {}
