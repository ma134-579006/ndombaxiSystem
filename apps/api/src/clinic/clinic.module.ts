import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';

/** Clínica / Saúde. PrismaService/TenantContext globais; InvoiceService via PosModule. */
@Module({
  imports: [PosModule],
  controllers: [ClinicController],
  providers: [ClinicService],
})
export class ClinicModule {}
