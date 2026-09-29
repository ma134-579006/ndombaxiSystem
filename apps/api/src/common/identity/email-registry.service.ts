import { ConflictException, Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const SCHEMA_RE = /^[a-z0-9_]+$/;
const CHUNK = 40;

/**
 * Unicidade GLOBAL de e-mail: um e-mail identifica uma única pessoa em toda a
 * plataforma — responsável de empresa, funcionário de qualquer empresa ou
 * Super Admin. Os utilizadores vivem em schemas isolados por empresa, por isso
 * a verificação percorre os schemas dos tenants (em blocos).
 */
@Injectable()
export class EmailRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async isTaken(email: string): Promise<boolean> {
    const e = email.trim().toLowerCase();
    if (!e) return false;

    const company = await this.prisma.company.findFirst({
      where: { responsibleEmail: { equals: e, mode: 'insensitive' } },
      select: { id: true },
    });
    if (company) return true;

    const platform = await this.prisma.platformUser.findFirst({
      where: { email: { equals: e, mode: 'insensitive' } },
      select: { id: true },
    });
    if (platform) return true;

    const schemas = (await this.prisma.company.findMany({ select: { schemaName: true } }))
      .map((c) => c.schemaName)
      .filter((s) => SCHEMA_RE.test(s));

    for (let i = 0; i < schemas.length; i += CHUNK) {
      const block = schemas.slice(i, i + CHUNK);
      if (await this.blockHasEmail(block, e)) return true;
    }
    return false;
  }

  async assertAvailable(email: string, message = 'Este e-mail já está registado no sistema. Use outro e-mail.'): Promise<void> {
    if (await this.isTaken(email)) throw new ConflictException(message);
  }

  private async blockHasEmail(schemas: string[], email: string): Promise<boolean> {
    const one = async (s: string): Promise<boolean> => {
      try {
        const rows = await this.prisma.$queryRaw<{ x: number }[]>(
          Prisma.sql`SELECT 1 AS x FROM ${Prisma.raw(`"${s}"`)}.users WHERE lower(email) = ${email} LIMIT 1`,
        );
        return rows.length > 0;
      } catch {
        return false; // schema sem tabela users (provisionamento falhado) — ignora
      }
    };
    try {
      const parts = schemas.map(
        (s) => Prisma.sql`SELECT 1 AS x FROM ${Prisma.raw(`"${s}"`)}.users WHERE lower(email) = ${email}`,
      );
      const rows = await this.prisma.$queryRaw<{ x: number }[]>(
        Prisma.sql`SELECT x FROM (${Prisma.join(parts, ' UNION ALL ')}) t LIMIT 1`,
      );
      return rows.length > 0;
    } catch {
      for (const s of schemas) if (await one(s)) return true;
      return false;
    }
  }
}

@Global()
@Module({ providers: [EmailRegistryService], exports: [EmailRegistryService] })
export class IdentityModule {}
