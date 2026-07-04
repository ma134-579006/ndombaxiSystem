import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedTenant {
  companyId: string;
  schema: string;
  name: string;
  /** Vertical de negócio (RETAIL | RESTAURANT | SERVICES | HOSPITALITY). */
  businessType: string;
}

/**
 * Resolve o tenant de uma montra pública (sem JWT) a partir do código da
 * empresa ou domínio personalizado. Só devolve empresas ACTIVE — uma loja
 * só está online depois de aprovada (§3.3, §6).
 */
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByCode(code: string): Promise<ResolvedTenant> {
    const company = await this.prisma.company.findUnique({ where: { code } });
    if (!company || company.status !== 'ACTIVE') {
      throw new NotFoundException('Loja não encontrada ou indisponível');
    }
    // Módulo Loja Online: se a empresa a desligou, o portal público fica
    // indisponível (todos os endpoints da montra passam por aqui). Tolerante a
    // tenants antigos sem a coluna → considera LIGADA (comportamento anterior).
    let onlineStoreEnabled = true;
    try {
      const rows = await this.prisma.runInTenant(company.schemaName, (tx) =>
        tx.$queryRaw<{ online_store_enabled: boolean }[]>(
          Prisma.sql`SELECT online_store_enabled FROM site_settings LIMIT 1`,
        ),
      );
      if (rows[0] && rows[0].online_store_enabled === false) onlineStoreEnabled = false;
    } catch { /* sem coluna/linha → fica ligada */ }
    if (!onlineStoreEnabled) {
      throw new NotFoundException('Esta loja não está disponível online');
    }
    return { companyId: company.id, schema: company.schemaName, name: company.name, businessType: company.sector || 'RETAIL' };
  }
}
