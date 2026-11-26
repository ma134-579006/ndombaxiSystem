import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AccountingReportsService } from './accounting-reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, AccountingReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
