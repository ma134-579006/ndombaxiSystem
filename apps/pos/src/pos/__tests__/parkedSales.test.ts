import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discard, MAX_PARKED, park, parseParked, resume } from '../parkedSales';

type L = { id: string; qty: number };
const lines = (n: number): L[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, qty: 1 }));

test('suspender guarda linhas e cliente; venda vazia não é suspensa', () => {
  const r = park<L>([], { lines: lines(3), customerId: 'c1' }, 's1', 100);
  assert.equal(r.parked, true);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0]?.customerId, 'c1');
  const vazio = park<L>(r.list, { lines: [], customerId: null }, 's2', 200);
  assert.equal(vazio.parked, false);
  assert.equal(vazio.list.length, 1);
});

test('limite de vendas suspensas é respeitado', () => {
  let list = [] as ReturnType<typeof park<L>>['list'];
  for (let i = 0; i < MAX_PARKED; i++) list = park<L>(list, { lines: lines(1), customerId: null }, `s${i}`, i).list;
  const r = park<L>(list, { lines: lines(1), customerId: null }, 'extra', 999);
  assert.equal(r.full, true);
  assert.equal(r.list.length, MAX_PARKED);
});

test('retomar com carrinho vazio: sai da lista', () => {
  const list = park<L>([], { lines: lines(2), customerId: null }, 's1', 1).list;
  const r = resume<L>(list, 's1', { lines: [], customerId: null }, 'swap', 2);
  assert.equal(r.sale?.lines.length, 2);
  assert.equal(r.list.length, 0);
});

test('retomar com carrinho cheio: troca, nada se perde', () => {
  const list = park<L>([], { lines: lines(2), customerId: 'a' }, 's1', 1).list;
  const r = resume<L>(list, 's1', { lines: lines(5), customerId: 'b' }, 'swap', 2);
  assert.equal(r.sale?.customerId, 'a');
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0]?.id, 'swap');
  assert.equal(r.list[0]?.lines.length, 5);
  assert.equal(r.list[0]?.customerId, 'b');
});

test('id inexistente não altera nada', () => {
  const list = park<L>([], { lines: lines(1), customerId: null }, 's1', 1).list;
  const r = resume<L>(list, 'nao-existe', { lines: lines(1), customerId: null }, 'x', 2);
  assert.equal(r.sale, null);
  assert.equal(r.list, list);
});

test('descartar e ler armazenamento corrompido', () => {
  const list = park<L>([], { lines: lines(1), customerId: null }, 's1', 1).list;
  assert.equal(discard(list, 's1').length, 0);
  assert.deepEqual(parseParked('{x'), []);
  assert.deepEqual(parseParked(JSON.stringify([{ id: 'a', lines: [], parkedAt: 1 }])), []);
  assert.equal(parseParked<L>(JSON.stringify(list)).length, 1);
});
