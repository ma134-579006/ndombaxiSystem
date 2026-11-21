import { checkReplicatedInvoice, checkReplicatedItem, expectedNumber } from './fiscal-replication.guard';

const base = () => ({
  id: '00000000-0000-0000-0000-000000000001',
  number: 'FT LAB12026/0005', doc_type: 'FT', series: 'LAB1', year: 2026, sequence: 5,
  invoice_date: '2026-11-20', net_total: 100, iva_total: 14, gross_total: 114,
  status: 'N', doc_state: 'ISSUED', hash: 'h', signable_string: 's',
});
const today = '2026-11-21';

describe('fatura replicada de um posto (Cenário I — segurança)', () => {
  it('aceita uma fatura coerente na série do posto', () => {
    expect(checkReplicatedInvoice(base(), { sequence: 4, invoice_date: '2026-11-19' }, today)).toEqual([]);
  });
  it('aceita o formato legado do número', () => {
    expect(checkReplicatedInvoice({ ...base(), number: 'FT LAB1/2026/0005' }, null, today)).toEqual([]);
  });
  it('FS imprime-se FR', () => expect(expectedNumber('FS', 'LAB1', 2026, 7)).toBe('FR LAB12026/0007'));
  it.each([
    ['série da nuvem', { series: 'A', number: 'FT A2026/0005' }, /posto local/],
    ['número incoerente', { number: 'FT LAB12026/0099' }, /não corresponde/],
    ['totais manipulados', { gross_total: 1 }, /bruto/],
    ['totais negativos', { net_total: -100, iva_total: -14, gross_total: -114 }, /negativos/],
    ['data futura', { invoice_date: '2026-12-01' }, /futura/],
    ['data fora do ano', { invoice_date: '2025-12-31' }, /fora do ano/],
    ['estado forjado', { status: 'X' }, /estado/],
    ['ciclo PAID', { doc_state: 'PAID' }, /ciclo/],
    ['sem hash', { hash: '' }, /hash/],
    ['tipo não fiscal', { doc_type: 'ORC', number: 'ORC LAB12026/0005' }, /tipo/],
    ['NC sem origem', { doc_type: 'NC', number: 'NC LAB12026/0005' }, /origem/],
  ])('recusa: %s', (_n, patch, re) => {
    const e = checkReplicatedInvoice({ ...base(), ...patch }, null, today);
    expect(e.join(' | ')).toMatch(re);
  });
  it('recusa reutilizar números da série', () => {
    expect(checkReplicatedInvoice(base(), { sequence: 5, invoice_date: '2026-11-19' }, today).join()).toMatch(/já usada/);
  });
  it('recusa data anterior à última da série', () => {
    expect(checkReplicatedInvoice(base(), { sequence: 4, invoice_date: '2026-11-21' }, '2026-11-22').join()).toMatch(/anterior/);
  });
});

describe('linha replicada', () => {
  const item = { invoice_id: 'x', quantity: 2, unit_price: 50, net_amount: 100, iva_amount: 14, gross_amount: 114 };
  it('aceita linha coerente', () => expect(checkReplicatedItem(item)).toEqual([]));
  it('recusa linha incoerente', () => expect(checkReplicatedItem({ ...item, gross_amount: 1 }).join()).toMatch(/bruto/));
  it('recusa quantidade zero', () => expect(checkReplicatedItem({ ...item, quantity: 0 }).join()).toMatch(/quantidade/));
});
