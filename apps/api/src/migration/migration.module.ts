import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';

@Module({
  imports: [CashboxModule],
  controllers: [MigrationController],
  providers: [MigrationService],
})
export class MigrationModule {}
