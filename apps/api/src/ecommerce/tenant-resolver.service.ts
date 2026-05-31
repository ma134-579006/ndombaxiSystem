import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedTenant {
  companyId: string;
  schema: string;
  name: string;
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
    return { companyId: company.id, schema: company.schemaName, name: company.name };
  }
}
