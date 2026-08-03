import { BadRequestException } from '@nestjs/common';
import { SnapshotService, topologicalOrder } from './snapshot.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * O que estes testes protegem:
 *
 * 1. A ORDEM. Inserir uma fatura antes do cliente dela parte na chave
 *    estrangeira. Se a ordem estiver errada, o provisionamento falha no posto
 *    do lojista — sem rede para ir lá ver porquê.
 * 2. O ÂMBITO. Isto devolve tudo o que a empresa tem. Um nome de tabela
 *    inventado não pode chegar ao SQL.
 */

describe('topologicalOrder — quem depende de quem', () => {
  const posicao = (lista: string[], n: string) => lista.indexOf(n);

  it('põe o pai antes do filho', () => {
    const o = topologicalOrder(
      ['invoices', 'customers'],
      [{ child: 'invoices', parent: 'customers' }],
    );
    expect(posicao(o, 'customers')).toBeLessThan(posicao(o, 'invoices'));
  });

  it('respeita uma cadeia de três', () => {
    const o = topologicalOrder(
      ['invoice_items', 'invoices', 'customers'],
      [
        { child: 'invoice_items', parent: 'invoices' },
        { child: 'invoices', parent: 'customers' },
      ],
    );
    expect(posicao(o, 'customers')).toBeLessThan(posicao(o, 'invoices'));
    expect(posicao(o, 'invoices')).toBeLessThan(posicao(o, 'invoice_items'));
  });

  it('uma tabela que se aponta a si própria não trava nada', () => {
    // Ex.: categoria com categoria-mãe. Resolve-se pela ordem das LINHAS,
    // não pela ordem das tabelas — se travasse aqui, ficava tudo parado.
    const o = topologicalOrder(
      ['product_categories', 'products'],
      [
        { child: 'product_categories', parent: 'product_categories' },
        { child: 'products', parent: 'product_categories' },
      ],
    );
    expect(o).toHaveLength(2);
    expect(posicao(o, 'product_categories')).toBeLessThan(posicao(o, 'products'));
  });

  it('um CICLO não faz perder tabelas (vão para o fim)', () => {
    // Perder uma tabela em silêncio seria muito pior do que inseri-la tarde:
    // a empresa chegava ao posto incompleta e ninguém dava por isso.
    const o = topologicalOrder(
      ['a', 'b', 'independente'],
      [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }],
    );
    expect(o.sort()).toEqual(['a', 'b', 'independente']);
  });

  it('não inventa tabelas a partir de arestas para fora do schema', () => {
    const o = topologicalOrder(['a'], [{ child: 'a', parent: 'tabela_de_outro_schema' }]);
    expect(o).toEqual(['a']);
  });

  it('devolve TODAS as tabelas, mesmo sem relações nenhumas', () => {
    const nomes = Array.from({ length: 75 }, (_, i) => `t${i}`);
    expect(topologicalOrder(nomes, []).sort()).toEqual([...nomes].sort());
  });
});

describe('SnapshotService — âmbito e paginação', () => {
  // Nome com a forma REAL de um schema de empresa (tenant_ + 8 hex).
  const SCHEMA = 'tenant_ab12cd34';

  function fake(tabelas: string[], linhas: unknown[] = []) {
    const queries: string[] = [];
    const prisma = {
      $queryRaw: jest.fn(async (q: unknown) => {
        const sql = (((q as { strings?: string[] }).strings) ?? []).join('?').replace(/\s+/g, ' ');
        queries.push(sql);
        if (sql.includes('information_schema.tables')) {
          return tabelas.map((t) => ({ table_name: t }));
        }
        if (sql.includes('pg_constraint')) return [];
        if (sql.includes('count(*)')) return tabelas.map((t) => ({ t, n: 3 }));
        return linhas;
      }),
    } as unknown as PrismaService;
    return { svc: new SnapshotService(prisma), queries };
  }

  it('recusa uma tabela que não é da empresa', async () => {
    const { svc } = fake(['products', 'customers']);
    await expect(svc.rows(SCHEMA, 'pg_shadow', 0, 10))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa uma tentativa de injeção pelo nome da tabela', async () => {
    const { svc, queries } = fake(['products']);
    await expect(svc.rows(SCHEMA, 'products"; DROP TABLE users; --', 0, 10))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(queries.join(' ')).not.toContain('DROP TABLE');
  });

  it('recusa um schema que não tem forma de schema de empresa', async () => {
    const { svc } = fake(['products']);
    await expect(svc.tables('nao-e-um-schema; DROP')).rejects.toThrow(/Invalid tenant schema/);
  });

  it('limita o tamanho da página (um posto com ligação fraca não aguenta tudo)', async () => {
    const { svc, queries } = fake(['products'], []);
    await svc.rows(SCHEMA, 'products', 0, 99999);
    expect(queries.some((q) => q.includes('LIMIT'))).toBe(true);
    expect(SnapshotService.MAX_LIMIT).toBeLessThanOrEqual(500);
  });

  it('diz que acabou quando a página vem incompleta', async () => {
    const { svc } = fake(['products'], [{ id: 1 }]);
    const r = await svc.rows(SCHEMA, 'products', 0, 200);
    expect(r.done).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('devolve as tabelas com contagem', async () => {
    const { svc } = fake(['products', 'customers']);
    const t = await svc.tables(SCHEMA);
    expect(t.map((x) => x.table).sort()).toEqual(['customers', 'products']);
    expect(t[0].rows).toBe(3);
  });

  it('sem contagens (tabela indisponível) ainda devolve as tabelas', async () => {
    const prisma = {
      $queryRaw: jest.fn(async (q: unknown) => {
        const sql = (((q as { strings?: string[] }).strings) ?? []).join('?');
        if (sql.includes('information_schema.tables')) return [{ table_name: 'products' }];
        if (sql.includes('pg_constraint')) return [];
        throw new Error('permission denied');
      }),
    } as unknown as PrismaService;
    const t = await new SnapshotService(prisma).tables(SCHEMA);
    expect(t).toEqual([{ table: 'products', rows: 0, dependsOn: [] }]);
  });
});
