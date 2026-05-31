import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { ChangePlanDto, ListTenantsDto } from './dto/list-tenants.dto';

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
    return this.prisma.company.findMany({
      where,
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');
    return company;
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
}
