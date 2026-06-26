import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { PasswordService } from '../auth/password.service';
import { ChangePlanDto, ListTenantsDto } from './dto/list-tenants.dto';
import { ResetTenantPasswordDto } from './dto/reset-password.dto';

interface ActorCtx {
  adminId: string;
  ip?: string | null;
}

/**
 * Gestão de Empresas (Tenants) pelo Super Admin (§2.2).
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
  ) {}

  async list(filters: ListTenantsDto) {
    const where: Prisma.CompanyWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.sector) where.sector = filters.sector;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search, mode: 'insensitive' } },
        { nif: { contains: filters.search } },
      ];
    }
    if (filters.planTier) {
      where.plan = { is: { tier: filters.planTier } };
    }
    const companies = await this.prisma.company.findMany({
      where,
      include: { plan: true, subscriptions: { where: { status: 'ACTIVE' }, select: { expiresAt: true, startsAt: true, isTrial: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const trialDays = await this.trialDays();
    return companies.map((c) => this.decorate(c, trialDays));
  }

  async get(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { plan: true, subscriptions: { where: { status: 'ACTIVE' }, select: { expiresAt: true, startsAt: true, isTrial: true } } },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');
    return this.decorate(company, await this.trialDays());
  }

  /** Dias de teste grátis actuais (editável pelo Super Admin; usado no trial dinâmico). */
  private async trialDays(): Promise<number> {
    const cfg = await this.prisma.landingConfig.findFirst({ select: { trialDays: true } });
    return Math.max(1, cfg?.trialDays ?? 14);
  }

  /** Validade efectiva de uma subscrição (trial = dinâmico; pago = expiresAt fixo). */
  private effExpiry(s: { expiresAt: Date | null; startsAt: Date | null; isTrial: boolean }, trialDays: number): Date | null {
    if (s.isTrial && s.startsAt) return new Date(s.startsAt.getTime() + trialDays * 86400000);
    return s.expiresAt;
  }

  /** Acrescenta a uma empresa o ESTADO REAL do plano: validade, dias restantes e
   *  se está expirado (mesmo com company.status ACTIVE). */
  private decorate<T extends { status: string; subscriptions: { expiresAt: Date | null; startsAt: Date | null; isTrial: boolean }[] }>(
    c: T,
    trialDays: number,
  ): T & { planExpired: boolean; planExpiresAt: string | null; planDaysLeft: number | null; planState: string } {
    const now = Date.now();
    const expiries = c.subscriptions
      .map((s) => this.effExpiry(s, trialDays))
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime());
    const top = expiries[0] ?? null;
    const hasValidity = expiries.length > 0;
    const planExpired = hasValidity && top!.getTime() <= now;
    const planDaysLeft = top ? Math.ceil((top.getTime() - now) / 86400000) : null;
    const planState = c.status === 'PENDING' ? 'PENDING'
      : c.status === 'SUSPENDED' ? 'SUSPENDED'
        : c.status === 'CANCELLED' ? 'CANCELLED'
          : planExpired ? 'EXPIRED' : 'ACTIVE';
    const { subscriptions: _omit, ...rest } = c as T & { subscriptions: unknown };
    return { ...(rest as T), planExpired, planExpiresAt: top ? top.toISOString() : null, planDaysLeft, planState };
  }

  async approve(id: string, ctx: ActorCtx) {
    const company = await this.get(id);
    if (company.status !== 'PENDING') {
      throw new BadRequestException('Empresa não está pendente');
    }
    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        approvedAt: new Date(),
        approvedByAdminId: ctx.adminId,
      },
    });
    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId,
      tenantSchema: company.schemaName,
      action: 'COMPANY_APPROVED',
      entity: 'Company',
      entityId: id,
      before: { status: company.status },
      after: { status: 'ACTIVE' },
      ip: ctx.ip,
    });
    await this.mail.send(
      company.responsibleEmail,
      `Ndombaxi System — Empresa aprovada`,
      `A empresa "${company.name}" foi aprovada. Já pode aceder com o código ${company.code}.`,
    );
    return updated;
  }

  async reject(id: string, ctx: ActorCtx) {
    const company = await this.get(id);
    if (company.status !== 'PENDING') {
      throw new BadRequestException('Empresa não está pendente');
    }
    const updated = await this.prisma.company.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId,
      tenantSchema: company.schemaName,
      action: 'COMPANY_REJECTED',
      entity: 'Company',
      entityId: id,
      before: { status: company.status },
      after: { status: 'CANCELLED' },
      ip: ctx.ip,
    });
    return updated;
  }

  async setStatus(
    id: string,
    status: 'SUSPENDED' | 'ACTIVE',
    ctx: ActorCtx,
  ) {
    const company = await this.get(id);
    const updated = await this.prisma.company.update({
      where: { id },
      data: { status },
    });
    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId,
      tenantSchema: company.schemaName,
      action: status === 'SUSPENDED' ? 'COMPANY_SUSPENDED' : 'COMPANY_REACTIVATED',
      entity: 'Company',
      entityId: id,
      before: { status: company.status },
      after: { status },
      ip: ctx.ip,
    });
    await this.mail.send(
      company.responsibleEmail,
      `Ndombaxi System — Estado da empresa alterado`,
      `O estado da empresa "${company.name}" passou para ${status}.`,
    );
    return updated;
  }

  async changePlan(id: string, dto: ChangePlanDto, ctx: ActorCtx) {
    const company = await this.get(id);
    const plan = await this.prisma.plan.findUnique({
      where: { tier: dto.planTier },
    });
    if (!plan) throw new BadRequestException('Plano inexistente');
    const updated = await this.prisma.company.update({
      where: { id },
      data: { planId: plan.id },
      include: { plan: true },
    });
    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId,
      tenantSchema: company.schemaName,
      action: 'COMPANY_PLAN_CHANGED',
      entity: 'Company',
      entityId: id,
      before: { planId: company.planId },
      after: { planId: plan.id, tier: plan.tier },
      ip: ctx.ip,
    });
    return updated;
  }

  /**
   * Reativar / dar BÓNUS de tempo a uma empresa (dias e/ou meses). Cria uma
   * subscrição ACTIVE de bónus que ESTENDE a validade a partir do maior entre
   * "agora" e a validade actual (não desperdiça dias que ainda restem) e
   * coloca a empresa ACTIVE. Resolve o caso de plano expirado sem renovação.
   */
  async grantBonus(id: string, opts: { days?: number; months?: number; note?: string }, ctx: ActorCtx) {
    const days = Math.max(0, Math.floor(opts.days ?? 0));
    const months = Math.max(0, Math.floor(opts.months ?? 0));
    if (days === 0 && months === 0) {
      throw new BadRequestException('Indique pelo menos 1 dia ou 1 mês de bónus.');
    }
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { subscriptions: { where: { status: 'ACTIVE' }, select: { expiresAt: true, startsAt: true, isTrial: true } } },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');

    const trialDays = await this.trialDays();
    const now = new Date();
    const current = company.subscriptions
      .map((s) => this.effExpiry(s, trialDays))
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const base = current && current.getTime() > now.getTime() ? current : now;
    const expiresAt = new Date(base);
    if (months) expiresAt.setMonth(expiresAt.getMonth() + months);
    if (days) expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.subscription.create({
      data: {
        companyId: id, planId: company.planId, method: 'IBAN', status: 'ACTIVE',
        amountKz: 0, durationMonths: months, durationDays: days, isTrial: false,
        startsAt: now, expiresAt,
        reviewedByAdminId: ctx.adminId, reviewedAt: now,
        reviewNote: opts.note?.trim() || `Bónus/Reativação pelo Super Admin (+${months}m ${days}d)`,
      },
    });
    await this.prisma.company.update({ where: { id }, data: { status: 'ACTIVE', approvedAt: company.approvedAt ?? now } });

    await this.audit.record({
      actorType: 'PLATFORM', actorId: ctx.adminId, tenantSchema: company.schemaName,
      action: 'COMPANY_BONUS_GRANTED', entity: 'Company', entityId: id,
      after: { months, days, expiresAt: expiresAt.toISOString() }, ip: ctx.ip,
    });
    await this.mail.send(
      company.responsibleEmail,
      'Ndombaxi System — Plano reativado',
      `O plano da empresa "${company.name}" foi reativado/estendido até ${expiresAt.toLocaleDateString('pt-PT')}. Já pode aceder normalmente.`,
    ).catch(() => undefined);

    return this.get(id);
  }

  /** Excluir empresa com limpeza completa do schema (§2.2). */
  async remove(id: string, ctx: ActorCtx) {
    const company = await this.get(id);
    await this.provisioning.dropTenantSchema(company.schemaName);
    await this.prisma.refreshToken.deleteMany({
      where: { tenantSchema: company.schemaName },
    });
    await this.prisma.company.delete({ where: { id } });
    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId,
      tenantSchema: company.schemaName,
      action: 'COMPANY_DELETED',
      entity: 'Company',
      entityId: id,
      before: { code: company.code, name: company.name },
      ip: ctx.ip,
    });
    return { deleted: true };
  }

  /**
   * Forçar reset de senha de um utilizador de uma empresa (§2.2). Gera uma
   * senha temporária, grava o hash Argon2id no schema do tenant e devolve-a ao
   * Super Admin (mostrada uma só vez) + envia por e-mail ao utilizador.
   */
  async resetUserPassword(id: string, dto: ResetTenantPasswordDto, ctx: ActorCtx) {
    const company = await this.get(id);
    const email = (dto.email ?? company.responsibleEmail).trim().toLowerCase();
    const temporaryPassword = randomBytes(9).toString('base64url');
    const hash = await this.passwords.hash(temporaryPassword);

    const rows = await this.prisma.runInTenant(company.schemaName, (tx) =>
      tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`UPDATE users SET password_hash = ${hash}
                   WHERE lower(email) = ${email} RETURNING id`,
      ),
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Utilizador ${email} não encontrado nesta empresa.`);
    }

    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId,
      tenantSchema: company.schemaName,
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: rows[0].id,
      after: { email },
      ip: ctx.ip,
    });
    await this.mail.send(
      email,
      'Ndombaxi System — Senha reposta',
      `A sua senha foi reposta pelo administrador. Senha temporária: ${temporaryPassword}\nAltere-a após entrar.`,
    );
    return { email, temporaryPassword };
  }

  /**
   * Exportar dados completos de uma empresa (RGPD, §2.2). Junta os dados
   * globais (empresa/plano) e os dados do schema do tenant (utilizadores
   * sanitizados, clientes, produtos, facturas, funcionários) num JSON.
   */
  async exportData(id: string, ctx: ActorCtx) {
    const company = await this.get(id);
    const data = await this.prisma.runInTenant(company.schemaName, async (tx) => {
      const exists = async (name: string) => {
        const r = await tx.$queryRaw<{ reg: string | null }[]>(
          Prisma.sql`SELECT to_regclass(${name})::text AS reg`,
        );
        return !!r[0]?.reg;
      };
      const out: Record<string, unknown> = {};
      if (await exists('users')) {
        out.users = await tx.$queryRaw(Prisma.sql`SELECT id, email, role, store_id, is_active, created_at FROM users LIMIT 10000`);
      }
      if (await exists('customers')) {
        out.customers = await tx.$queryRaw(Prisma.sql`SELECT * FROM customers LIMIT 10000`);
      }
      if (await exists('products')) {
        out.products = await tx.$queryRaw(Prisma.sql`SELECT * FROM products LIMIT 10000`);
      }
      if (await exists('invoices')) {
        out.invoices = await tx.$queryRaw(Prisma.sql`SELECT id, number, doc_type, invoice_date, net_total, iva_total, gross_total, status FROM invoices ORDER BY system_entry_date DESC LIMIT 10000`);
      }
      if (await exists('employees')) {
        out.employees = await tx.$queryRaw(Prisma.sql`SELECT * FROM employees LIMIT 10000`);
      }
      return out;
    });

    await this.audit.record({
      actorType: 'PLATFORM',
      actorId: ctx.adminId,
      tenantSchema: company.schemaName,
      action: 'COMPANY_DATA_EXPORTED',
      entity: 'Company',
      entityId: id,
      ip: ctx.ip,
    });

    return {
      exportedAt: new Date().toISOString(),
      company: {
        id: company.id, code: company.code, name: company.name, nif: company.nif,
        responsibleEmail: company.responsibleEmail, status: company.status,
        plan: company.plan?.tier ?? null, createdAt: company.createdAt,
      },
      data,
    };
  }
}
