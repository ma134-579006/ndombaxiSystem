import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Listas de configuração (como no Vendus, Configuração › Definições):
 *  - `units`      — Unidades de medida usadas na ficha do produto;
 *  - `nc-reasons` — Motivos das Notas de Crédito propostos ao anular/devolver.
 * Na 1.ª leitura a lista começa com as sugestões de origem (DEFAULTS), que a empresa
 * pode depois editar ou apagar.
 */
export const LIST_KINDS = ['units', 'nc-reasons'] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const DEFAULTS: Record<ListKind, string[]> = {
  units: ['un', 'kg', 'g', 'L', 'ml', 'fatia', 'folha', 'dose', 'porção', 'caixa', 'pacote', 'garrafa', 'lata'],
  'nc-reasons': ['Devolução de artigos', 'Anulação do documento', 'Erro na faturação', 'Artigo com defeito', 'Desconto concedido após a venda'],
};
export interface ListItem { id: string; label: string; }

export function assertKind(kind: string): ListKind {
  if (!(LIST_KINDS as readonly string[]).includes(kind)) throw new NotFoundException('Lista desconhecida.');
  return kind as ListKind;
}
export function cleanLabel(kind: ListKind, raw: unknown): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const max = kind === 'units' ? 16 : 200;
  if (!s) throw new BadRequestException('Escreva o nome.');
  if (s.length > max) throw new BadRequestException(`Máximo ${max} caracteres.`);
  return s;
}

@Injectable()
export class ConfigListsService {
  constructor(private readonly prisma: PrismaService) {}

  private async seeded(tx: Prisma.TransactionClient, kind: ListKind): Promise<boolean> {
    const r = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM config_lists WHERE kind = ${kind}`);
    return (r[0]?.n ?? 0) > 0;
  }
  /** Primeira alteração: copia as sugestões de origem para a tabela (para se poderem editar/apagar). */
  private async seed(tx: Prisma.TransactionClient, kind: ListKind) {
    if (await this.seeded(tx, kind)) return;
    let i = 0;
    for (const label of DEFAULTS[kind]) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO config_lists (kind, label, sort) VALUES (${kind}, ${label}, ${i++}) ON CONFLICT DO NOTHING`);
    }
  }

  list(schema: string, kind: ListKind): Promise<ListItem[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.seed(tx, kind);
      return tx.$queryRaw<ListItem[]>(Prisma.sql`SELECT id::text AS id, label FROM config_lists WHERE kind = ${kind} ORDER BY sort, label`);
    });
  }

  add(schema: string, kind: ListKind, raw: unknown) {
    const label = cleanLabel(kind, raw);
    return this.prisma.runInTenant(schema, async (tx) => {
      await this.seed(tx, kind);
      const dup = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id::text AS id FROM config_lists WHERE kind = ${kind} AND lower(label) = lower(${label})`);
      if (dup.length) throw new ConflictException('Já existe na lista.');
      await tx.$executeRaw(Prisma.sql`INSERT INTO config_lists (kind, label, sort)
        VALUES (${kind}, ${label}, (SELECT COALESCE(MAX(sort), -1) + 1 FROM config_lists WHERE kind = ${kind}))`);
      return { ok: true as const };
    });
  }

  rename(schema: string, kind: ListKind, id: string, raw: unknown) {
    const label = cleanLabel(kind, raw);
    return this.prisma.runInTenant(schema, async (tx) => {
      const dup = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id::text AS id FROM config_lists WHERE kind = ${kind} AND lower(label) = lower(${label}) AND id <> ${id}::uuid`);
      if (dup.length) throw new ConflictException('Já existe na lista.');
      const n = await tx.$executeRaw(Prisma.sql`UPDATE config_lists SET label = ${label} WHERE kind = ${kind} AND id = ${id}::uuid`);
      if (!n) throw new NotFoundException('Não encontrado.');
      return { ok: true as const };
    });
  }

  remove(schema: string, kind: ListKind, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const n = await tx.$executeRaw(Prisma.sql`DELETE FROM config_lists WHERE kind = ${kind} AND id = ${id}::uuid`);
      if (!n) throw new NotFoundException('Não encontrado.');
      return { ok: true as const };
    });
  }
}
