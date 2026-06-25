import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrRepository } from './hr.repository';
import { PayrollService } from './payroll.service';
import { SelfConsumptionController } from './self-consumption.controller';
import { SelfConsumptionService } from './self-consumption.service';
import { SalaryAdvanceController } from './salary-advance.controller';
import { SalaryAdvanceService } from './salary-advance.service';

@Module({
  controllers: [HrController, SelfConsumptionController, SalaryAdvanceController],
  providers: [HrRepository, PayrollService, SelfConsumptionService, SalaryAdvanceService],
  exports: [HrRepository, PayrollService, SelfConsumptionService, SalaryAdvanceService],
})
export class HrModule {}
