import { BadRequestException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * O que estes testes protegem é a invariante mais cara do sistema: **dois
 * postos nunca podem partilhar uma série fiscal**.
 *
 * Se partilharem, cada um constrói a sua cadeia de hash a partir do mesmo
 * ponto e ficam duas cadeias divergentes com a MESMA numeração. Isso não tem
 * correção depois de acontecer — renumerar muda o hash e invalida tudo o que
 * vem a seguir, e os documentos já foram entregues aos clientes. É o único
 * erro deste projeto que não se pode desfazer.
 */

/**
 * Base de dados de mentira, mas com as regras que interessam: o contador é
 * atómico e `device_key` é único. É contra ISTO que o serviço tem de acertar.
 */
function fakeDb() {
  const devices: Record<string, Record<string, unknown>> = {};
  let counter = 0;
  const tx = {
    $queryRaw: jest.fn(async (q: { strings?: string[]; values?: unknown[] } | unknown) => {
      const sql = ((q as { strings?: string[] }).strings ?? []).join('?').replace(/\s+/g, ' ');
      const v = (q as { values?: unknown[] }).values ?? [];
      if (sql.includes('INSERT INTO document_counters')) {
        counter += 1;
        return [{ last_sequence: counter }];
      }
      if (sql.includes('SELECT * FROM devices WHERE device_key')) {
        const d = devices[String(v[0])];
        return d ? [d] : [];
      }
      if (sql.includes('SELECT series, is_active FROM devices')) {
        const d = devices[String(v[0])];
        return d ? [{ series: d.series, is_active: d.is_active }] : [];
      }
      if (sql.includes('UPDATE devices SET name')) {
        const d = devices[String(v[3])];
        if (d) { d.name = v[0] as string; d.platform = v[1] as string; }
        return d ? [d] : [];
      }
      if (sql.includes('INSERT INTO devices')) {
        const key = String(v[0]);
        const row = {
          id: `id-${key}`, device_key: key, name: v[1], platform: v[2],
          store_id: v[3] ?? null, series: v[4], is_active: true,
          registered_at: new Date(), last_seen_at: new Date(),
        };
        devices[key] = row;
        return [row];
      }
      if (sql.includes('FROM devices d')) return Object.values(devices);
      return [];
    }),
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = {
    runInTenant: jest.fn(async (_schema: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  return { prisma, devices, seriesEmitidas: () => Object.values(devices).map((d) => d.series) };
}

describe('DevicesService — série por posto', () => {
  it('dá séries DIFERENTES a postos diferentes (a invariante que segura tudo)', async () => {
    const db = fakeDb();
    const svc = new DevicesService(db.prisma);
    await svc.register('t', { deviceKey: 'posto-caixa-1', name: 'Caixa 1', platform: 'windows' });
    await svc.register('t', { deviceKey: 'posto-caixa-2', name: 'Caixa 2', platform: 'windows' });
    await svc.register('t', { deviceKey: 'posto-telemovel', name: 'Telemóvel', platform: 'android' });

    const series = db.seriesEmitidas();
    expect(new Set(series).size).toBe(3);
    expect(series).toEqual(['A1', 'A2', 'A3']);
  });

  it('nunca usa a série "A" — essa fica reservada ao histórico já emitido', async () => {
    const db = fakeDb();
    const svc = new DevicesService(db.prisma);
    await svc.register('t', { deviceKey: 'posto-novo-1', name: 'Novo', platform: 'windows' });
    expect(db.seriesEmitidas()).not.toContain('A');
  });

  it('registar o MESMO posto outra vez devolve a MESMA série (idempotente)', async () => {
    const db = fakeDb();
    const svc = new DevicesService(db.prisma);
    const a = await svc.register('t', { deviceKey: 'posto-caixa-1', name: 'Caixa 1', platform: 'windows' });
    const b = await svc.register('t', { deviceKey: 'posto-caixa-1', name: 'Caixa 1 (renomeada)', platform: 'windows' });
    expect(b.series).toBe(a.series);
    // Uma série nova a cada arranque daria dezenas de cadeias por posto.
    expect(db.seriesEmitidas()).toEqual([a.series]);
  });

  it('recusa um identificador de posto que não é sério', async () => {
    const svc = new DevicesService(fakeDb().prisma);
    await expect(svc.register('t', { deviceKey: 'abc', name: 'x', platform: 'windows' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('devolve a série do posto registado', async () => {
    const db = fakeDb();
    const svc = new DevicesService(db.prisma);
    await svc.register('t', { deviceKey: 'posto-caixa-1', name: 'Caixa 1', platform: 'windows' });
    expect(await svc.seriesFor('t', 'posto-caixa-1')).toBe('A1');
  });

  it('posto NÃO registado devolve null — a venda segue como sempre, sem travar a loja', async () => {
    const svc = new DevicesService(fakeDb().prisma);
    expect(await svc.seriesFor('t', 'posto-desconhecido')).toBeNull();
    expect(await svc.seriesFor('t', null)).toBeNull();
    expect(await svc.seriesFor('t', '')).toBeNull();
  });

  it('um schema por migrar não derruba a venda (devolve null em vez de rebentar)', async () => {
    const prisma = {
      runInTenant: jest.fn(async () => { throw new Error('relation "devices" does not exist'); }),
    } as unknown as PrismaService;
    const svc = new DevicesService(prisma);
    await expect(svc.seriesFor('t', 'posto-caixa-1')).resolves.toBeNull();
  });

  it('posto desativado deixa de impor série (deixa de emitir por ali)', async () => {
    const db = fakeDb();
    const svc = new DevicesService(db.prisma);
    await svc.register('t', { deviceKey: 'posto-caixa-1', name: 'Caixa 1', platform: 'windows' });
    (db.devices['posto-caixa-1'] as { is_active: boolean }).is_active = false;
    expect(await svc.seriesFor('t', 'posto-caixa-1')).toBeNull();
  });
});
