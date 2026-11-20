import { DocumentType } from '../document-types';
import { IvaCode } from '../iva';
import { computeInvoice } from '../tax-calculator';
import { buildSaftXml } from './saft-builder';
import { validateSaftXsd } from './xsd-validate';

const company = { taxRegistrationNumber: '5000000001', companyName: 'Empresa Teste, Lda', fiscalYear: 2026, startDate: '2026-11-01', endDate: '2026-11-30', addressDetail: 'Rua 1', city: 'Luanda' };
function doc(type: DocumentType, n: string, lines: Parameters<typeof computeInvoice>[0], extra: Record<string, unknown> = {}) {
  const { lines: ls, totals } = computeInvoice(lines);
  return { type, number: n, invoiceDate: '2026-11-15', systemEntryDate: '2026-11-15T10:00:00', lines: ls, totals, hash: 'a'.repeat(172), signatureKeyVersion: 1, ...extra };
}

it('um SAF-T de facturação com FT, FR, NC e isenção é válido no XSD', async () => {
  const xml = buildSaftXml({
    company,
    documents: [
      doc(DocumentType.FT, 'FT A2026/0001', [
        { productCode: 'P1', description: 'Café & Açúcar', quantity: 2, unitPrice: 1000, ivaCode: IvaCode.NOR },
        { productCode: 'P2', description: 'Arroz', quantity: 3, unitPrice: 333.33, ivaCode: IvaCode.ISE, exemptionCode: 'M10', exemptionReason: 'Isento nos termos da alínea a) do nº1 do artigo 12.º do CIVA' },
      ], { customerTaxId: '5417000000' }),
      doc(DocumentType.FS, 'FR A2026/0001', [{ productCode: 'P1', description: 'Café', quantity: 1, unitPrice: 1000, ivaCode: IvaCode.NOR, discountRate: 0.1 }]),
      doc(DocumentType.NC, 'NC A2026/0001', [{ productCode: 'P1', description: 'Café', quantity: 1, unitPrice: 1000, ivaCode: IvaCode.NOR }], { reference: 'FT A2026/0001', customerTaxId: '5417000000' }),
    ],
  });
  const r = await validateSaftXsd(xml);
  if (!r.valid) console.log(r.issues.slice(0, 10));
  expect(r.valid).toBe(true);
}, 60000);

