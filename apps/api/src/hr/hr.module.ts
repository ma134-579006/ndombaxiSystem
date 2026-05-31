import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrRepository } from './hr.repository';
import { PayrollService } from './payroll.service';

@Module({
  controllers: [HrController],
  providers: [HrRepository, PayrollService],
  exports: [HrRepository, PayrollService],
})
export class HrModule {}
