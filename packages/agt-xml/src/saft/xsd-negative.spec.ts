import { DocumentType } from '../document-types';
import { IvaCode } from '../iva';
import { computeInvoice } from '../tax-calculator';
import type { FiscalDocument } from '../types';
import { buildSaftXml } from './saft-builder';
import { validateSaftSemantics } from './saft-semantic';
import { validateSaftXsd } from './xsd-validate';

const company = { taxRegistrationNumber: '5000000001', companyName: 'Empresa Teste, Lda', fiscalYear: 2026, startDate: '2026-11-01', endDate: '2026-11-30', addressDetail: 'Rua 1', city: 'Luanda' };
const line = { productCode: 'P1', description: 'X', quantity: 1, unitPrice: 100, ivaCode: IvaCode.NOR };
function doc(type: DocumentType, n: string, extra: Partial<FiscalDocument> = {}): FiscalDocument {
  const { lines, totals } = computeInvoice([line]);
  return { type, number: n, invoiceDate: '2026-11-15', systemEntryDate: '2026-11-15T10:00:00', lines, totals, hash: 'a'.repeat(172), ...extra };
}
const ok = () => buildSaftXml({ company, documents: [doc(DocumentType.FT, 'FT A2026/0001')] });

describe('XSD — testes negativos (Cenário E)', () => {
  it('o ficheiro de referência é válido', async () => {
    expect((await validateSaftXsd(ok())).valid).toBe(true);
  }, 60000);

  const cases: [string, (x: string) => string][] = [
    ['XML malformado', (x) => x.replace('</AuditFile>', '')],
    ['campo obrigatório em falta (TaxRegistrationNumber)', (x) => x.replace(/<TaxRegistrationNumber>[^<]*<\/TaxRegistrationNumber>/, '')],
    ['data inválida', (x) => x.replace('<InvoiceDate>2026-11-15</InvoiceDate>', '<InvoiceDate>2026-13-45</InvoiceDate>')],
    ['InvoiceNo fora do padrão', (x) => x.replace('<InvoiceNo>FT A2026/0001</InvoiceNo>', '<InvoiceNo>FT A/2026/0001</InvoiceNo>')],
    ['tipo de documento inexistente (FS)', (x) => x.replace('<InvoiceType>FT</InvoiceType>', '<InvoiceType>FS</InvoiceType>')],
    ['namespace errado', (x) => x.replace('AO_1.01_01"', 'PT_1.04_01"')],
    ['valor monetário não numérico', (x) => x.replace(/<GrossTotal>[^<]*<\/GrossTotal>/, '<GrossTotal>cem</GrossTotal>')],
  ];
  it.each(cases)('recusa: %s', async (_n, mutate) => {
    const r = await validateSaftXsd(mutate(ok()));
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  }, 60000);
});

describe('validação semântica (Cenário E)', () => {
  const period = { startDate: '2026-11-01', endDate: '2026-11-30' };
  const ft = (n: string, extra: Partial<FiscalDocument> = {}) => doc(DocumentType.FT, n, extra);
  const nc = (extra: Partial<FiscalDocument> = {}) => doc(DocumentType.NC, 'NC A2026/0001', extra);
  const bad = (t: Partial<FiscalDocument['totals']>) => ({ ...ft('FT A2026/0001'), totals: { netTotal: 100, ivaTotal: 14, grossTotal: 114, byTaxCode: [], ...t } });

  it('documentos coerentes → sem problemas', () => {
    expect(validateSaftSemantics([ft('FT A2026/0001'), ft('FT A2026/0002')], period)).toEqual([]);
  });
  const cases: [string, FiscalDocument[], string][] = [
    ['duplicado', [ft('FT A2026/0001'), ft('FT A2026/0001')], 'S01-DUPLICADO'],
    ['buraco na sequência', [ft('FT A2026/0001'), ft('FT A2026/0003')], 'S03-SEQUENCIA'],
    ['data fora de ordem', [ft('FT A2026/0001', { invoiceDate: '2026-11-20' }), ft('FT A2026/0002', { invoiceDate: '2026-11-10' })], 'S04-DATA-ORDEM'],
    ['fora do período', [ft('FT A2026/0001', { invoiceDate: '2026-10-31' })], 'S06-PERIODO'],
    ['NIF inválido', [ft('FT A2026/0001', { customerTaxId: '12AB' })], 'S07-NIF'],
    ['GrossTotal incoerente', [bad({ grossTotal: 200 })], 'S11-GROSSTOTAL'],
    ['IVA incorrecto', [bad({ ivaTotal: 20, grossTotal: 120 })], 'S10-TAXPAYABLE'],
    ['NetTotal incoerente', [bad({ netTotal: 90, grossTotal: 104 })], 'S09-NETTOTAL'],
    ['NC sem origem', [nc()], 'S15-REFERENCIA'],
    ['referência inexistente', [nc({ reference: 'FT Z2026/0009' })], 'S16-REFERENCIA-FORA'],
    ['sem hash', [ft('FT A2026/0001', { hash: undefined })], 'S17-HASH'],
  ];
  it.each(cases)('%s', (_n, docs, rule) => {
    expect(validateSaftSemantics(docs, period).map((i) => i.rule)).toContain(rule);
  });
});
