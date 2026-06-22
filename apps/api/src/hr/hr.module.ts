import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrRepository } from './hr.repository';
import { PayrollService } from './payroll.service';
import { SelfConsumptionController } from './self-consumption.controller';
import { SelfConsumptionService } from './self-consumption.service';

@Module({
  controllers: [HrController, SelfConsumptionController],
  providers: [HrRepository, PayrollService, SelfConsumptionService],
  exports: [HrRepository, PayrollService, SelfConsumptionService],
})
export class HrModule {}
