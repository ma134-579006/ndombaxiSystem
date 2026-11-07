import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideHydration,
  describeReconcile,
  hasUnsyncedChanges,
  parseStoredCart,
  reconcileWithCatalog,
  type CatalogProduct,
  type StoredCart,
} from '../cartPersist';

const prod = (id: string, stock: number, extra: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id, name: `Produto ${id}`, stock_qty: String(stock), ...extra,
});

const cart = (n: number, updatedAt: number, syncedAt: number): StoredCart<CatalogProduct> => ({
  v: 2,
  lines: Array.from({ length: n }, (_, i) => ({ product: prod(`p${i}`, 100), quantity: 1 })),
  customerId: null,
  updatedAt,
  syncedAt,
});

test('formato antigo (array) é lido e conta como não sincronizado', () => {
  const raw = JSON.stringify([{ product: prod('a', 5), quantity: 2 }]);
  const c = parseStoredCart<CatalogProduct>(raw);
  assert.ok(c);
  assert.equal(c.lines.length, 1);
  assert.equal(hasUnsyncedChanges(c), true);
});

test('JSON corrompido ou linhas inválidas não rebentam', () => {
  assert.equal(parseStoredCart('{nao json'), null);
  const c = parseStoredCart<CatalogProduct>(JSON.stringify({ v: 2, lines: [{ quantity: 1 }, { product: prod('x', 1), quantity: 0 }], updatedAt: 5, syncedAt: 0 }));
  assert.ok(c);
  assert.equal(c.lines.length, 0);
});

test('B-01: internet cai após 50 artigos, recarrega com rede → o local não é substituído', () => {
  // 1 artigo chegou ao servidor (syncedAt=10); depois, offline, chegou-se a 50.
  const local = cart(50, 20, 10);
  assert.equal(decideHydration(local, true), 'local');
});

test('B-01: internet cai após o 1.º artigo (nunca sincronizado) → fica o local', () => {
  assert.equal(decideHydration(cart(1, 5, 0), true), 'local');
});

test('carrinho local vazio → recupera o rascunho do servidor (outro aparelho)', () => {
  assert.equal(decideHydration(null, true), 'server');
  assert.equal(decideHydration(cart(0, 0, 0), true), 'server');
});

test('local já sincronizado → o servidor é a versão mais recente', () => {
  assert.equal(decideHydration(cart(3, 10, 10), true), 'server');
  assert.equal(decideHydration(cart(3, 10, 10), false), 'server');
});

test('B-02: produto eliminado e sem stock são reportados, não somem em silêncio', () => {
  const lines = [
    { product: prod('a', 10), quantity: 2 },
    { product: prod('b', 10), quantity: 1 },
    { product: prod('c', 10), quantity: 5 },
  ];
  const r = reconcileWithCatalog(lines, [prod('a', 10), prod('c', 3), prod('b', 0)].filter((p) => p.id !== 'zz'));
  assert.equal(r.changed, true);
  assert.deepEqual(r.removed, [{ name: 'Produto b', reason: 'out_of_stock' }]);
  assert.deepEqual(r.clamped, [{ name: 'Produto c', from: 5, to: 3 }]);
  const msg = describeReconcile(r);
  assert.match(msg ?? '', /Sem stock/);
  assert.match(msg ?? '', /Produto c \(5→3\)/);

  const gone = reconcileWithCatalog(lines, [prod('a', 10), prod('c', 10)]);
  assert.deepEqual(gone.removed, [{ name: 'Produto b', reason: 'missing' }]);
});

test('pratos sob encomenda (ficha técnica) nunca são removidos por stock 0', () => {
  const p = prod('r', 0, { has_recipe: true });
  const r = reconcileWithCatalog([{ product: p, quantity: 4 }], [p]);
  assert.equal(r.removed.length, 0);
  assert.equal(r.lines[0]?.quantity, 4);
});

test('sem alterações → devolve a MESMA referência (sem re-render)', () => {
  const p = prod('a', 10);
  const lines = [{ product: p, quantity: 1 }];
  const r = reconcileWithCatalog(lines, [p]);
  assert.equal(r.changed, false);
  assert.equal(r.lines, lines);
  assert.equal(describeReconcile(r), null);
});
