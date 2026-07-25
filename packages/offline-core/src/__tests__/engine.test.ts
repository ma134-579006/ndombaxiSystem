/**
 * Suite de QA do motor Offline-First.
 *
 * Não testa "se o código corre". Testa as promessas que fizemos ao utilizador,
 * e cada teste tem o nome do desastre que evita:
 *   • corte de energia a meio de um envio
 *   • rede a oscilar durante a sincronização
 *   • servidor a receber a mesma venda duas vezes
 *   • dois postos a editar o mesmo cliente
 *   • semanas offline seguidas de um regresso em massa
 *
 * Corre com o executor nativo do Node: `node --test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SyncEngine } from '../engine';
import { MemoryAdapter } from '../storage/memory';
import { NetMonitor } from '../net';
import { TransportError, type SyncTransport } from '../transport';
import { resolveConflict } from '../conflict';
import { backoffDelay } from '../backoff';
import type { OutboxOp, PullChange, PushResponse } from '../types';

// ── Duplos de teste ──────────────────────────────────────────

/** Servidor falso: guarda o que recebeu e aplica idempotência a sério. */
class FakeServer {
  readonly appliedOpIds = new Set<string>();
  readonly receivedBatches: OutboxOp[][] = [];
  /** Quantas chamadas ainda devem falhar antes de começar a aceitar. */
  failNext = 0;
  failWith: Error = new TransportError(0, 'Sem ligação ao servidor.');
  conflictOn = new Set<string>();
  rejectOn = new Set<string>();
  serverState = new Map<string, PullChange>();

  push = async (ops: OutboxOp[]): Promise<PushResponse> => {
    if (this.failNext > 0) { this.failNext--; throw this.failWith; }
    this.receivedBatches.push(ops);
    return {
      results: ops.map((op) => {
        if (this.rejectOn.has(op.localId)) {
          return { opId: op.opId, status: 'rejected' as const, message: 'Stock insuficiente.', code: 'NO_STOCK' };
        }
        if (this.conflictOn.has(op.localId)) {
          return {
            opId: op.opId, status: 'conflict' as const,
            entity: this.serverState.get(op.localId)!,
          };
        }
        // Idempotência: o mesmo opId nunca é aplicado duas vezes.
        const duplicate = this.appliedOpIds.has(op.opId);
        this.appliedOpIds.add(op.opId);
        return {
          opId: op.opId,
          status: duplicate ? ('duplicate' as const) : ('applied' as const),
          serverId: `srv-${op.localId}`,
          entity: {
            entity: op.entity, id: `srv-${op.localId}`,
            data: op.payload, version: 1,
            updatedAt: new Date().toISOString(), deleted: false,
          },
        };
      }),
      serverTime: new Date().toISOString(),
    };
  };

  transport(): SyncTransport {
    return {
      push: this.push,
      pull: async () => ({
        changes: [], cursor: 'c1', hasMore: false, serverTime: new Date().toISOString(),
      }),
    };
  }
}

/** Monitor de rede controlado à mão — sem sondas reais. */
function fakeNet(state: 'ONLINE' | 'OFFLINE' = 'ONLINE'): NetMonitor {
  const n = new NetMonitor({ healthUrl: 'http://localhost/health' });
  // O motor só consulta `subscribe`, `start`, `stop`, `probe` e `getClockSkewMs`.
  const self = n as unknown as Record<string, unknown>;
  self.state = state;
  self.start = () => undefined;
  self.stop = () => undefined;
  self.probe = async () => state;
  return n;
}

async function makeEngine(server: FakeServer, link: 'ONLINE' | 'OFFLINE' = 'ONLINE') {
  const storage = new MemoryAdapter();
  const engine = new SyncEngine({
    storage,
    transport: server.transport(),
    net: fakeNet(link),
    entities: ['product', 'customer'],
    idleIntervalMs: 3_600_000, // sem ciclos de fundo a interferir no teste
  });
  await engine.start();
  return { engine, storage };
}

// ── Testes ───────────────────────────────────────────────────

test('uma venda offline fica em disco antes de a função retornar', async () => {
  const server = new FakeServer();
  const { engine, storage } = await makeEngine(server, 'OFFLINE');

  await engine.enqueue({ entity: 'sale', op: 'create', localId: 'v1', payload: { total: 5000 } });

  const fila = await storage.outboxAll();
  assert.equal(fila.length, 1, 'a venda tem de estar na fila mesmo sem rede');
  assert.equal(fila[0].status, 'PENDING');
  assert.equal(server.receivedBatches.length, 0, 'nada podia ter subido — estamos offline');
  await engine.stop();
});

test('corte de energia a meio do envio: a venda volta à fila e não se perde', async () => {
  const server = new FakeServer();
  const storage = new MemoryAdapter();

  // Simula o estado deixado por uma app que morreu com a operação já a sair.
  await storage.open();
  await storage.outboxAppend({
    opId: 'op-morta', seq: 1, entity: 'sale', op: 'create', localId: 'v9',
    payload: { total: 1200 }, baseVersion: null,
    createdAt: new Date().toISOString(), attempts: 1,
    nextAttemptAt: 0, status: 'INFLIGHT',
  });

  const engine = new SyncEngine({
    storage, transport: server.transport(), net: fakeNet('ONLINE'),
    entities: [], idleIntervalMs: 3_600_000,
  });
  await engine.start(); // a recuperação de arranque tem de repor a operação

  const reposta = await storage.outboxGet('op-morta');
  assert.ok(reposta === null || reposta.status !== 'INFLIGHT',
    'nenhuma operação pode ficar presa em INFLIGHT após um arranque');

  await engine.sync();
  assert.ok(server.appliedOpIds.has('op-morta'), 'a venda órfã tem de acabar no servidor');
  await engine.stop();
});

test('acordar do background retoma a venda presa (bug do minimizar)', async () => {
  const server = new FakeServer();
  const storage = new MemoryAdapter();

  // Monitor REAL, com a rede controlada pela sonda (como em produção): a app
  // abriu sem rede. Reproduzimos o cenário Android/iOS — os eventos `online`/
  // `visibilitychange` NUNCA disparam (em Node não há `window`, por isso
  // `net.start()`/`stop()` são no-op de propósito); a única forma de o motor
  // reavaliar a ligação é o `wake()` que o shell nativo passa a chamar.
  let online = false;
  let probes = 0;
  const net = new NetMonitor({
    healthUrl: 'http://localhost/health',
    fetchImpl: async () => {
      probes++;
      if (!online) throw new Error('sem rede');
      return new Response(null, { status: 200 });
    },
  });
  await net.probe(); // estado real inicial → não-ONLINE (abriu sem servidor alcançável)
  assert.notEqual(net.getState(), 'ONLINE');

  const engine = new SyncEngine({
    storage, transport: server.transport(), net,
    entities: ['product'], idleIntervalMs: 3_600_000,
  });
  await engine.start();

  // Venda feita offline enquanto a app estava em segundo plano.
  await engine.enqueue({ entity: 'sale', op: 'create', localId: 'v1', payload: { total: 7000 } });
  assert.equal(server.receivedBatches.length, 0, 'offline: a venda não podia ter subido');

  // A internet volta enquanto a app dormia — sem disparar qualquer evento.
  online = true;
  const probesAntes = probes;

  // O utilizador reabre a app: o shell nativo chama `wake()`. É isto que
  // conserta o bug — reavalia a ligação REAL e retoma a sincronização sozinho.
  await engine.wake();
  await new Promise((r) => setTimeout(r, 30)); // deixa o ciclo agendado por wake() correr

  assert.ok(probes > probesAntes, 'wake() tem de reavaliar a ligação real (sonda ao /health)');
  assert.equal(server.receivedBatches.length, 1, 'ao acordar, a venda presa tem de subir sem ajuda');
  assert.ok(server.appliedOpIds.has(server.receivedBatches[0][0].opId));
  await engine.stop();
});

test('reenvio após falha de rede não duplica a venda (idempotência)', async () => {
  const server = new FakeServer();
  const { engine } = await makeEngine(server);

  await engine.enqueue({ entity: 'sale', op: 'create', localId: 'v2', payload: { total: 999 } });

  // Primeira tentativa morre na rede; a segunda passa.
  server.failNext = 1;
  await engine.sync();
  await engine.retry((await engine.outbox())[0].opId); // limpa o backoff
  await engine.sync();

  const todosOpIds = server.receivedBatches.flat().map((o) => o.opId);
  assert.equal(new Set(todosOpIds).size, 1, 'foi sempre o MESMO opId a ser reenviado');
  assert.equal(server.appliedOpIds.size, 1, 'o servidor aplicou a venda uma única vez');
  assert.equal((await engine.outbox()).length, 0, 'a fila tem de ficar vazia no fim');
  await engine.stop();
});

test('recusa de negócio pára a operação em vez de a repetir em ciclo', async () => {
  const server = new FakeServer();
  server.rejectOn.add('v3');
  const { engine } = await makeEngine(server);

  await engine.enqueue({ entity: 'sale', op: 'create', localId: 'v3', payload: { total: 1 } });
  await engine.sync();

  const fila = await engine.outbox();
  assert.equal(fila[0].status, 'BLOCKED', 'tem de esperar por um humano');
  assert.equal(fila[0].lastErrorCode, 'NO_STOCK', 'o motivo tem de chegar à UI');
  assert.equal(engine.getStatus().blocked, 1);
  await engine.stop();
});

test('conflito num documento fiscal NUNCA é resolvido em silêncio', () => {
  const venda: OutboxOp = {
    opId: 'x', seq: 1, entity: 'sale', op: 'update', localId: 'v4',
    payload: { total: 100 }, baseVersion: 1, createdAt: '', attempts: 0,
    nextAttemptAt: 0, status: 'PENDING',
  };
  const servidor: PullChange = {
    entity: 'sale', id: 'v4', data: { total: 250 }, version: 2,
    updatedAt: '', deleted: false,
  };
  const r = resolveConflict(venda, servidor);
  assert.equal(r.action, 'block', 'dinheiro e fiscal exigem decisão humana');
});

test('conflito numa ficha de cliente une campos sem repor dados do gestor', () => {
  const edicaoLocal: OutboxOp = {
    opId: 'y', seq: 1, entity: 'customer', op: 'update', localId: 'c1',
    // O balcão só mexeu no telefone — mas envia o registo todo, incluindo um
    // limite de crédito já desatualizado.
    payload: { phone: '923000111', creditLimit: 5000 },
    baseVersion: 1, createdAt: '', attempts: 0, nextAttemptAt: 0, status: 'PENDING',
  };
  const servidor: PullChange = {
    entity: 'customer', id: 'c1',
    data: { phone: '911222333', creditLimit: 90000, name: 'Ana' },
    version: 7, updatedAt: '', deleted: false,
  };

  const r = resolveConflict(edicaoLocal, servidor);
  assert.equal(r.action, 'retry-rebased');
  if (r.action !== 'retry-rebased') return;
  assert.equal(r.payload.phone, '923000111', 'o telefone que o balcão corrigiu tem de vencer');
  assert.equal(r.payload.creditLimit, 90000, 'o limite de crédito do gestor NÃO pode ser reposto');
  assert.equal(r.payload.name, 'Ana', 'campos intocados vêm do servidor');
  assert.equal(r.baseVersion, 7, 'o reenvio tem de assentar na versão nova');
});

test('registo apagado no servidor não é ressuscitado sozinho', () => {
  const op: OutboxOp = {
    opId: 'z', seq: 1, entity: 'customer', op: 'update', localId: 'c2',
    payload: { name: 'X' }, baseVersion: 1, createdAt: '', attempts: 0,
    nextAttemptAt: 0, status: 'PENDING',
  };
  const r = resolveConflict(op, {
    entity: 'customer', id: 'c2', data: null, version: 9, updatedAt: '', deleted: true,
  });
  assert.equal(r.action, 'block');
});

test('regresso em massa após semanas offline sobe tudo, por ordem e sem perdas', async () => {
  const server = new FakeServer();
  const { engine } = await makeEngine(server, 'OFFLINE');

  for (let i = 0; i < 120; i++) {
    await engine.enqueue({ entity: 'sale', op: 'create', localId: `v${i}`, payload: { n: i } });
  }
  assert.equal((await engine.outbox()).length, 120);

  // A internet volta.
  (engine as unknown as { status: { link: string } }).status.link = 'ONLINE';
  await engine.sync();

  assert.equal((await engine.outbox()).length, 0, 'a fila tem de ficar vazia');
  assert.equal(server.appliedOpIds.size, 120, 'nenhuma venda pode faltar');
  const ordem = server.receivedBatches.flat().map((o) => o.seq);
  assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b), 'a ordem de criação tem de ser respeitada');
  await engine.stop();
});

test('ids locais são reescritos para ids do servidor nas operações seguintes', async () => {
  const server = new FakeServer();
  const { engine } = await makeEngine(server);

  // Cliente criado offline, e logo a seguir uma venda que o referencia.
  await engine.enqueue({ entity: 'customer', op: 'create', localId: 'cli-local', payload: { name: 'Novo' } });
  await engine.sync();

  await engine.enqueue({
    entity: 'sale', op: 'create', localId: 'v-ref',
    payload: { customerId: 'cli-local', total: 3000 },
  });
  await engine.sync();

  const venda = server.receivedBatches.flat().find((o) => o.localId === 'v-ref');
  assert.equal((venda?.payload as { customerId: string }).customerId, 'srv-cli-local',
    'a venda tem de apontar para o id real do cliente no servidor');
  await engine.stop();
});

test('o recuo exponencial cresce, respeita o teto e nunca é igual entre postos', () => {
  const policy = { baseMs: 1000, maxMs: 60_000, factor: 2, jitter: 0.5 };
  const media = (n: number) => {
    let s = 0;
    for (let i = 0; i < 400; i++) s += backoffDelay(n, policy);
    return s / 400;
  };
  assert.ok(media(3) > media(1), 'tem de crescer com as tentativas');
  for (let i = 0; i < 200; i++) {
    assert.ok(backoffDelay(20, policy) <= 60_000 * 1.5 + 1, 'nunca acima do teto + dispersão');
  }
  const amostras = new Set(Array.from({ length: 50 }, () => backoffDelay(5, policy)));
  assert.ok(amostras.size > 10, 'a dispersão evita que 8 caixas ataquem o servidor no mesmo instante');
});

test('operação BLOCKED pode ser descartada pelo gestor sem afetar as outras', async () => {
  const server = new FakeServer();
  server.rejectOn.add('mau');
  const { engine } = await makeEngine(server);

  await engine.enqueue({ entity: 'sale', op: 'create', localId: 'mau', payload: {} });
  await engine.enqueue({ entity: 'sale', op: 'create', localId: 'bom', payload: {} });
  await engine.sync();

  const bloqueada = (await engine.outbox()).find((o) => o.localId === 'mau');
  assert.ok(bloqueada);
  await engine.discard(bloqueada!.opId);

  assert.equal((await engine.outbox()).length, 0);
  assert.ok(server.appliedOpIds.size >= 1, 'a operação boa passou na mesma');
  await engine.stop();
});
