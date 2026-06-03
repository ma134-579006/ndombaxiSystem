import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';
import { TenantUserRepository } from '../tenancy/tenant-user.repository';
import { PasswordService } from '../auth/password.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { Role } from '../rbac/roles.enum';
import { NifService } from './nif.service';
import { RegisterCompanyDto } from './dto/register-company.dto';

export interface OnboardingResult {
  companyId: string;
  companyCode: string;
  status: string;
  adminEmail: string;
  // devolvido apenas em dev; em produção vai só por e-mail
  temporaryPassword: string;
  /** Token curto (7 dias) que autoriza concluir a subscrição na landing (sem login). */
  setupToken: string;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly tenantUsers: TenantUserRepository,
    private readonly passwords: PasswordService,
    private readonly nif: NifService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private generateTempPassword(): string {
    // 16 chars base64url — entropia suficiente para senha temporária
    return randomBytes(12).toString('base64url');
  }

  /** Onboarding automático de empresa (§3.3). */
  async register(dto: RegisterCompanyDto): Promise<OnboardingResult> {
    const nifCheck = await this.nif.validateWithAgt(dto.nif);
    if (!nifCheck.valid) {
      throw new BadRequestException(nifCheck.reason ?? 'NIF inválido');
    }

    const clash = await this.prisma.company.findFirst({
      where: { OR: [{ code: dto.companyCode }, { nif: dto.nif }] },
    });
    if (clash) {
      throw new ConflictException(
        'Já existe uma empresa com este código ou NIF',
      );
    }

    const plan = await this.prisma.plan.findUnique({
      where: { tier: dto.planTier },
    });
    if (!plan) {
      throw new BadRequestException('Plano inexistente');
    }

    const schemaName = this.provisioning.generateSchemaName();
    const tempPassword = this.generateTempPassword();
    const adminEmail = dto.responsibleEmail.toLowerCase();
    const passwordHash = await this.passwords.hash(tempPassword);

    // 1) Cria a empresa (PENDING) no schema global
    const company = await this.prisma.company.create({
      data: {
        code: dto.companyCode,
        name: dto.name,
        nif: dto.nif,
        iban: dto.iban ?? null,
        responsibleName: dto.responsibleName,
        responsibleEmail: adminEmail,
        responsiblePhone: dto.responsiblePhone ?? null,
        sector: dto.sector ?? null,
        planId: plan.id,
        schemaName,
        status: 'PENDING',
      },
    });

    try {
      // 2) Provisiona o schema isolado do tenant
      await this.provisioning.createTenantSchema(schemaName);

      // 3) Cria loja padrão + utilizador Company Admin inicial
      const store = await this.tenantUsers.createStore(schemaName, {
        code: 'LOJA-001',
        name: `${dto.name} — Loja Principal`,
        isDefault: true,
      });
      await this.tenantUsers.createUser(schemaName, {
        email: adminEmail,
        passwordHash,
        name: dto.responsibleName,
        role: Role.COMPANY_ADMIN,
        storeId: store.id,
        mustResetPw: true,
      });
    } catch (err) {
      // Rollback: limpa o schema e a empresa se o provisioning falhar
      this.logger.error(
        `Falha no provisioning de ${schemaName}; a reverter`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.provisioning.dropTenantSchema(schemaName).catch(() => undefined);
      await this.prisma.company
        .delete({ where: { id: company.id } })
        .catch(() => undefined);
      throw new BadRequestException('Falha ao provisionar a empresa');
    }

    await this.audit.record({
      actorType: 'SYSTEM',
      tenantSchema: schemaName,
      action: 'COMPANY_REGISTERED',
      entity: 'Company',
      entityId: company.id,
      after: { code: company.code, name: company.name, status: 'PENDING' },
    });

    await this.mail.sendWelcome(
      adminEmail,
      company.name,
      company.code,
      tempPassword,
    );

    // Token de configuração: autoriza concluir a subscrição (escolher plano +
    // enviar comprovativo) na própria landing, sem login, durante 7 dias.
    const setupToken = await this.jwt.signAsync(
      { sub: company.id, typ: 'setup' },
      { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }), expiresIn: '7d' },
    );

    return {
      companyId: company.id,
      companyCode: company.code,
      status: company.status,
      adminEmail,
      temporaryPassword: tempPassword,
      setupToken,
    };
  }
}
