import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';

/** Férias / ausências (RH). */
@Module({
  imports: [CashboxModule],
  controllers: [LeaveController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}
