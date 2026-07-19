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
import { GoogleAuthService } from '../auth/google-auth.service';
import { TokenService, TokenPair } from '../auth/token.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '@nexus/types';
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
    private readonly google: GoogleAuthService,
    private readonly tokens: TokenService,
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
      // O local de stock é a LOJA principal (criada acima). Sem "armazém".
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

  /** Marca o estado de setup de um tenant (linha única em site_settings). */
  private async setSetupCompleted(schema: string, value: boolean): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM site_settings LIMIT 1`,
      );
      if (rows[0]) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE site_settings SET setup_completed = ${value}, updated_at = now()
                     WHERE id = ${rows[0].id}::uuid`,
        );
      } else {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO site_settings (setup_completed) VALUES (${value})`,
        );
      }
    });
  }

  /**
   * Registo SIMPLES (estilo loja online): a empresa cria conta só com EMAIL +
   * palavra-passe própria OU Google. Fica em estado PENDING com código/NIF
   * provisórios; o setup obrigatório (nome, código, NIF, logo) é concluído
   * depois (após o pagamento) antes de poder usar o painel. Devolve tokens
   * (auto-login) para a empresa concluir o setup.
   */
  async registerSimple(
    dto: { email?: string; password?: string; googleIdToken?: string; planTier: string; businessType?: string },
    ctx: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ tokens: TokenPair; companyCode: string; setupCompleted: false }> {
    let email: string;
    let displayName: string;
    let passwordHash: string;

    if (dto.googleIdToken) {
      const profile = await this.google.verify(dto.googleIdToken);
      email = profile.email;
      displayName = profile.name || email.split('@')[0];
      passwordHash = await this.passwords.hash(randomBytes(18).toString('base64url'));
    } else {
      if (!dto.email || !dto.password || dto.password.length < 8) {
        throw new BadRequestException('Indique um e-mail e uma palavra-passe (mín. 8 caracteres).');
      }
      email = dto.email.toLowerCase();
      displayName = email.split('@')[0];
      passwordHash = await this.passwords.hash(dto.password);
    }

    const existing = await this.prisma.company.findFirst({ where: { responsibleEmail: email } });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail. Inicie sessão.');
    }

    const plan = await this.prisma.plan.findUnique({ where: { tier: dto.planTier as never } });
    if (!plan) throw new BadRequestException('Plano inexistente.');

    // Período de teste grátis (dias) definido pelo Super Admin (default 14).
    const cfg = await this.prisma.landingConfig.findFirst({ select: { trialDays: true } });
    const trialDays = Math.max(1, cfg?.trialDays ?? 14);

    const schemaName = this.provisioning.generateSchemaName();
    const rnd = randomBytes(4).toString('hex');
    const tempCode = `emp-${rnd}`;
    const tempNif = `TMP${Date.now()}${rnd}`.slice(0, 18);

    const company = await this.prisma.company.create({
      data: {
        code: tempCode,
        name: displayName,
        nif: tempNif,
        responsibleName: displayName,
        responsibleEmail: email,
        // Tipo de negócio (adapta o painel ao vertical): guardado em `sector`.
        sector: (dto.businessType ?? 'RETAIL'),
        planId: plan.id,
        schemaName,
        // Acesso IMEDIATO com período de teste grátis (ativa já; bloqueia ao fim
        // do trial até renovar). Empresas existentes sem subscrição não são afectadas.
        status: 'ACTIVE',
      },
    });

    let adminUserId: string;
    try {
      await this.provisioning.createTenantSchema(schemaName);
      const store = await this.tenantUsers.createStore(schemaName, {
        code: 'LOJA-001', name: `${displayName} — Loja Principal`, isDefault: true,
      });
      const admin = await this.tenantUsers.createUser(schemaName, {
        email, passwordHash, name: displayName, role: Role.COMPANY_ADMIN,
        storeId: store.id, mustResetPw: false,
      });
      adminUserId = admin.id;
      await this.setSetupCompleted(schemaName, false); // exige setup obrigatório
    } catch (err) {
      this.logger.error(`Falha no provisioning de ${schemaName}; a reverter`, err instanceof Error ? err.stack : undefined);
      await this.provisioning.dropTenantSchema(schemaName).catch(() => undefined);
      await this.prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
      throw new BadRequestException('Falha ao criar a conta. Tente novamente.');
    }

    // Subscrição de TESTE GRÁTIS: activa já, válida por `trialDays` dias. Ao
    // expirar, isPlanExpired/getSetupStatus bloqueiam a empresa (caixa + gestor)
    // e mostram a página de renovação. (Empresas antigas sem subscrição NÃO são
    // afectadas — o guard `wasActivated` protege-as.)
    const trialExpiresAt = new Date(Date.now() + trialDays * 86400000);
    await this.prisma.subscription.create({
      data: {
        companyId: company.id, planId: plan.id, method: 'IBAN',
        status: 'ACTIVE', amountKz: 0, durationMonths: 0, durationDays: trialDays,
        isTrial: true,
        startsAt: new Date(), expiresAt: trialExpiresAt,
        reviewNote: `Período de teste grátis (${trialDays} dias)`,
      },
    }).catch((e) => {
      this.logger.error('Falha ao criar subscrição de teste', e instanceof Error ? e.stack : undefined);
    });

    await this.audit.record({
      actorType: 'SYSTEM', tenantSchema: schemaName, action: 'COMPANY_REGISTERED_SIMPLE',
      entity: 'Company', entityId: company.id, after: { email, via: dto.googleIdToken ? 'google' : 'password', trialDays },
    });

    const payload: JwtPayload = {
      sub: adminUserId, email, name: displayName, role: Role.COMPANY_ADMIN,
      subjectType: 'TENANT', tenantId: company.id, tenantSchema: schemaName, twoFaVerified: true,
    };
    const tokens = await this.tokens.issuePair(payload, ctx);
    return { tokens, companyCode: company.code, setupCompleted: false };
  }

  /** Plano atual da empresa (para o passo de pagamento do setup obrigatório). */
  async getMyPlan(tenantId: string | undefined): Promise<{ planId: string; planName: string; priceKz: number; tier: string } | null> {
    if (!tenantId) return null;
    const company = await this.prisma.company.findUnique({ where: { id: tenantId }, include: { plan: true } });
    if (!company?.plan) return null;
    return { planId: company.plan.id, planName: company.plan.name, priceKz: Number(company.plan.priceKz), tier: company.plan.tier };
  }

  /**
   * PRIMEIROS PASSOS (onboarding de setor, Fase 3 da auditoria): contagens
   * reais do tenant para o guia de 1.ª execução por vertical — o frontend
   * decide os passos consoante o businessType. Só LEITURA; cada tabela de
   * vertical é guardada por to_regclass (tenants antigos podem não a ter).
   */
  async firstSteps(schema: string): Promise<Record<string, number>> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const count = async (table: string, where?: Prisma.Sql): Promise<number> => {
        const reg = await tx.$queryRaw<{ r: string | null }[]>(
          Prisma.sql`SELECT to_regclass(${table})::text AS r`);
        if (!reg[0]?.r) return 0;
        const rows = await tx.$queryRaw<{ n: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS n FROM ${Prisma.raw(`"${table}"`)} ${where ?? Prisma.empty}`);
        return rows[0]?.n ?? 0;
      };
      const [products, invoices, tables, equipments, rooms, professionals, patients] = await Promise.all([
        count('products', Prisma.sql`WHERE is_active = TRUE`),
        count('invoices'),
        count('restaurant_tables'),
        count('service_equipments'),
        count('hotel_rooms'),
        count('clinic_professionals'),
        count('clinic_patients'),
      ]);
      return { products, invoices, tables, equipments, rooms, professionals, patients };
    });
  }

  /** Estado do setup + aprovação do tenant autenticado. */
  async getSetupStatus(
    tenantId: string | undefined,
    schema: string,
  ): Promise<{ setupCompleted: boolean; status: string; approved: boolean; expired: boolean; expiresAt: string | null }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ setup_completed: boolean }[]>(
        Prisma.sql`SELECT setup_completed FROM site_settings LIMIT 1`,
      ),
    );
    let status = 'ACTIVE';
    let expired = false;
    let expiresAt: string | null = null;
    if (tenantId) {
      const c = await this.prisma.company.findUnique({ where: { id: tenantId }, select: { status: true } });
      status = c?.status ?? 'ACTIVE';
      // Validade do plano: só bloqueia se a empresa JÁ teve subscrições e nenhuma
      // está válida agora (empresas legadas sem subscrição NÃO são bloqueadas).
      const subs = await this.prisma.subscription.findMany({
        where: { companyId: tenantId },
        select: { status: true, expiresAt: true, startsAt: true, isTrial: true },
        orderBy: { createdAt: 'desc' },
      });
      // Validade efectiva de cada subscrição: para TRIAL é DINÂMICA (startsAt +
      // trialDays actuais — editável pelo Super Admin); para planos pagos usa o
      // expiresAt fixo gravado na activação.
      const trialDays = Math.max(1, (await this.prisma.landingConfig.findFirst({ select: { trialDays: true } }))?.trialDays ?? 14);
      const eff = (s: { expiresAt: Date | null; startsAt: Date | null; isTrial: boolean }): Date | null => {
        if (s.isTrial && s.startsAt) return new Date(s.startsAt.getTime() + trialDays * 86400000);
        return s.expiresAt;
      };
      // Só "expirado" se já houve um plano ATIVADO (com validade) e este expirou.
      // Subscrições só por aprovar (sem validade) ou empresas sem subscrição
      // NÃO bloqueiam — protege os tenants existentes.
      const wasActivated = subs.some((s) => eff(s));
      if (wasActivated) {
        const now = Date.now();
        const valid = subs.find((s) => s.status === 'ACTIVE' && (() => { const e = eff(s); return !e || e.getTime() > now; })());
        expired = !valid;
        // Maior validade entre as subscrições ACTIVE (a que protege o acesso).
        const activeExpiries = subs
          .filter((s) => s.status === 'ACTIVE')
          .map((s) => eff(s))
          .filter((d): d is Date => !!d)
          .sort((a, b) => b.getTime() - a.getTime());
        expiresAt = activeExpiries[0]?.toISOString() ?? null;
      }
    }
    return {
      setupCompleted: rows[0]?.setup_completed ?? true,
      status,
      approved: status === 'ACTIVE',
      expired,
      expiresAt,
    };
  }

  /** Converte um nome em slug (sem acentos, minúsculas, hífens) — base do código. */
  private slugify(name: string): string {
    const base = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos/diacríticos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    return base.length >= 2 ? base : `empresa-${randomBytes(2).toString('hex')}`;
  }

  /** Gera um código de loja único a partir do nome (sufixo aleatório se colidir). */
  private async generateUniqueCode(name: string, excludeId: string): Promise<string> {
    const base = this.slugify(name);
    let code = base;
    for (let i = 0; i < 30; i++) {
      const clash = await this.prisma.company.findFirst({
        where: { code, NOT: { id: excludeId } },
        select: { id: true },
      });
      if (!clash) return code;
      code = `${base}-${randomBytes(2).toString('hex')}`.slice(0, 40);
    }
    return `${base}-${randomBytes(4).toString('hex')}`.slice(0, 40);
  }

  /**
   * Conclui o setup obrigatório: define nome, código (gerado do nome se omitido),
   * NIF (validado AGT) e logótipo; activa a empresa e desbloqueia o painel.
   */
  async completeSetup(
    tenantId: string | undefined,
    schema: string,
    dto: { name: string; companyCode?: string; nif: string; logoUrl?: string },
  ): Promise<{ ok: true; companyCode: string }> {
    if (!tenantId) throw new BadRequestException('Sessão inválida.');
    if (!dto.name?.trim()) throw new BadRequestException('Indique o nome da empresa.');

    const nifCheck = await this.nif.validateWithAgt(dto.nif);
    if (!nifCheck.valid) throw new BadRequestException(nifCheck.reason ?? 'NIF inválido.');

    // Código da loja: o utilizador já não o escreve — é gerado a partir do nome
    // (slug único). Mantém-se aceitar um código explícito (compatibilidade/API).
    let code: string;
    const explicit = (dto.companyCode ?? '').trim().toLowerCase();
    if (explicit) {
      if (!/^[a-z0-9-]{2,40}$/.test(explicit)) {
        throw new BadRequestException('Código inválido (use minúsculas, dígitos e hífens).');
      }
      const clash = await this.prisma.company.findFirst({ where: { code: explicit, NOT: { id: tenantId } } });
      if (clash) throw new ConflictException('Já existe uma empresa com este código.');
      code = explicit;
    } else {
      code = await this.generateUniqueCode(dto.name, tenantId);
    }

    const nifClash = await this.prisma.company.findFirst({
      where: { nif: dto.nif, NOT: { id: tenantId } },
    });
    if (nifClash) throw new ConflictException('Já existe uma empresa com este NIF.');

    // NÃO ativa a empresa aqui: fica PENDING até o Super Admin aprovar a
    // subscrição/pagamento. Só guarda os dados (nome, código, NIF).
    await this.prisma.company.update({
      where: { id: tenantId },
      data: { name: dto.name.trim(), code, nif: dto.nif },
    });

    await this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM site_settings LIMIT 1`,
      );
      if (rows[0]) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE site_settings SET brand_name = ${dto.name.trim()},
                       logo_url = COALESCE(${dto.logoUrl ?? null}, logo_url),
                       setup_completed = TRUE, updated_at = now()
                     WHERE id = ${rows[0].id}::uuid`,
        );
      } else {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO site_settings (brand_name, logo_url, setup_completed)
                     VALUES (${dto.name.trim()}, ${dto.logoUrl ?? null}, TRUE)`,
        );
      }
    });

    await this.audit.record({
      actorType: 'TENANT', tenantSchema: schema, action: 'COMPANY_SETUP_COMPLETED',
      entity: 'Company', entityId: tenantId, after: { code, name: dto.name },
    });
    return { ok: true, companyCode: code };
  }
}
