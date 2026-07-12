import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { PosModule } from '../pos/pos.module';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';
import { HospitalService } from './hospital.service';

/**
 * Clínica / Hospital (HIS). ClinicService = agenda/pacientes/consultas;
 * HospitalService = domínio hospitalar enterprise (profissionais, receitas com
 * dispensa FEFO na farmácia, sinais vitais, leitos/internação, triagem de
 * emergência, exames, prontuário). PrismaService/TenantContext globais;
 * InvoiceService via PosModule; TenantAuditService via CashboxModule.
 */
@Module({
  imports: [PosModule, CashboxModule],
  controllers: [ClinicController],
  providers: [ClinicService, HospitalService],
  exports: [ClinicService, HospitalService],
})
export class ClinicModule {}
