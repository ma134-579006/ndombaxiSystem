import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffController } from './staff.controller';
import { StaffRepository } from './staff.repository';
import { StaffService } from './staff.service';
import { PlanLimitsService } from '../plans/plan-limits.service';

/**
 * Gestão de equipa (funcionários) e lojas da empresa. Usa PasswordService
 * (AuthModule) para as senhas/PIN, e TenantContext/AuditService (globais).
 */
@Module({
  imports: [AuthModule],
  controllers: [StaffController],
  providers: [StaffService, StaffRepository, PlanLimitsService],
  exports: [StaffService],
})
export class StaffModule {}
