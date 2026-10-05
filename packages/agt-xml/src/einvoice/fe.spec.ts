import { generateKeyPairSync } from 'node:crypto';
import { IvaCode } from '../iva';
import { signJws, verifyJws, rsaKeyBits } from './jws';
import {
  buildFeQrUrl,
  buildObterEstado,
  buildRegistarFactura,
  buildSolicitarSerie,
  formatFeDocumentNo,
  validateFeDocument,
  type FeSigningContext,
  type FeSourceDocument,
} from './fe';

const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

describe('Facturação Electrónica AGT (JWS RS256)', () => {
  const sw = pair();
  const tp = pair();
  const ctx: FeSigningContext = {
    taxRegistrationNumber: '5001636863',
    software: { productId: 'Ndombaxi System/Ndombaxi', productVersion: '1.0.0', softwareValidationNumber: 'C_134', signatureVersion: 1 },
    softwarePrivateKeyPem: sw.privateKey,
    taxpayerPrivateKeyPem: tp.privateKey,
  };
  const doc = (over: Partial<FeSourceDocument> = {}): FeSourceDocument => ({
    type: 'FT',
    number: 'FT FT6325S2C/1000020',
    invoiceDate: '2026-09-29',
    systemEntryDate: '2026-09-29T11:27:08',
    customerTaxId: null,
    customerName: null,
    lines: [
      { productCode: 'P1', description: 'Arroz 1kg', quantity: 2, unitPrice: 500, ivaCode: IvaCode.NOR, ivaRate: 14, netAmount: 1000, ivaAmount: 140, grossAmount: 1140 },
    ],
    totals: { netTotal: 1000, ivaTotal: 140, grossTotal: 1140 },
    ...over,
  });

  it('JWS: header RS256, base64url sem padding, verificável e chave ≥ 2048', () => {
    const jws = signJws({ a: 1 }, tp.privateKey);
    expect(jws.split('.')).toHaveLength(3);
    expect(jws).not.toContain('=');
    expect(JSON.parse(Buffer.from(jws.split('.')[0], 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(verifyJws(jws, tp.publicKey)).toEqual({ valid: true, payload: { a: 1 } });
    expect(verifyJws(jws, sw.publicKey).valid).toBe(false);
    expect(rsaKeyBits(tp.publicKey)).toBe(2048);
    expect(rsaKeyBits('lixo')).toBe(0);
  });

  it('registarFactura: envelope, consumidor final e assinaturas verificáveis', () => {
    const req = buildRegistarFactura(ctx, [doc()]) as Record<string, any>;
    expect(req.schemaVersion).toBe('2.0');
    expect(req.submissionUUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(req.numberOfEntries).toBe(1);
    const d = req.documents[0];
    expect(d.customerTaxID).toBe('999999999');
    expect(d.companyName).toBe('Consumidor Final');
    expect(d.systemEntryDate).toBe('2026-09-29T11:27:08');
    expect(d.documentTotals).toEqual({ taxPayable: 140, netTotal: 1000, grossTotal: 1140 });
    expect(d.lines[0]).toMatchObject({ lineNumber: 1, operationType: 'SE', unitPriceBase: 500, creditAmount: 1000, settlementAmount: 0 });
    expect(d.lines[0].taxes[0]).toMatchObject({ taxType: 'IVA', taxCode: 'NOR', taxPercentage: 14, taxContribution: 140 });

    const dv = verifyJws(d.jwsDocumentSignature, tp.publicKey);
    expect(dv.valid).toBe(true);
    expect((dv.payload as any).documentNo).toBe('FT FT6325S2C/1000020');
    expect(Object.keys(dv.payload as object)).toEqual([
      'documentNo', 'taxRegistrationNumber', 'documentType', 'documentDate', 'customerTaxID', 'customerCountry', 'companyName', 'documentTotals',
    ]);
    const sv = verifyJws(req.softwareInfo.jwsSoftwareSignature, sw.publicKey);
    expect(sv.valid).toBe(true);
    expect(sv.payload).toEqual({ productId: 'Ndombaxi System/Ndombaxi', productVersion: '1.0.0', softwareValidationNumber: 'C_134' });
  });

  it('FS → FR e NC usa debitAmount + referenceInfo', () => {
    const fs = buildRegistarFactura(ctx, [doc({ type: 'FS', number: 'FR FR6325S2C/5' })]) as Record<string, any>;
    expect(fs.documents[0].documentType).toBe('FR');
    expect(formatFeDocumentNo('FS', 'FR6325S2C', 5)).toBe('FR FR6325S2C/5');
    const nc = buildRegistarFactura(ctx, [doc({ type: 'NC', number: 'NC NC6325S2C/1', reference: 'FT FT6325S2C/1000020' })]) as Record<string, any>;
    expect(nc.documents[0].lines[0].debitAmount).toBe(1000);
    expect(nc.documents[0].lines[0].creditAmount).toBeUndefined();
    expect(nc.documents[0].lines[0].referenceInfo).toEqual({ reference: 'FT FT6325S2C/1000020' });
  });

  it('máximo 30 documentos e pelo menos 1', () => {
    expect(() => buildRegistarFactura(ctx, [])).toThrow();
    expect(() => buildRegistarFactura(ctx, Array.from({ length: 31 }, () => doc()))).toThrow(/30/);
  });

  it('pré-validação local (E22/E23/E24/E02/E13/E18)', () => {
    expect(validateFeDocument(doc())).toEqual([]);
    expect(validateFeDocument(doc({ totals: { netTotal: 999, ivaTotal: 140, grossTotal: 1140 } })).map((e) => e.code)).toContain('E23');
    expect(validateFeDocument(doc({ totals: { netTotal: 1000, ivaTotal: 100, grossTotal: 1100 } })).map((e) => e.code)).toContain('E22');
    expect(validateFeDocument(doc({ totals: { netTotal: 1000, ivaTotal: 140, grossTotal: 1200 } })).map((e) => e.code)).toContain('E24');
    expect(validateFeDocument(doc({ number: 'FT A/2026/0001' })).map((e) => e.code)).toContain('E02');
    expect(validateFeDocument(doc({ type: 'NC', number: 'NC NC6325S2C/1' })).map((e) => e.code)).toContain('E13');
    const ise = doc();
    ise.lines[0] = { ...ise.lines[0], ivaCode: IvaCode.ISE, ivaRate: 0, ivaAmount: 0, grossAmount: 1000 };
    ise.totals = { netTotal: 1000, ivaTotal: 0, grossTotal: 1000 };
    expect(validateFeDocument(ise).map((e) => e.code)).toContain('E18');
  });

  it('solicitarSerie, obterEstado, QR e número na série AGT', () => {
    const s = buildSolicitarSerie(ctx, { seriesYear: 2026, documentType: 'FT', establishmentNumber: '1' }) as Record<string, any>;
    expect((verifyJws(s.jwsSignature, tp.publicKey).payload as any).seriesContingencyIndicator).toBe('N');
    const o = buildObterEstado(ctx, 'REQ-000001') as Record<string, any>;
    expect(verifyJws(o.jwsSignature, tp.publicKey).payload).toEqual({ taxRegistrationNumber: '5001636863', requestID: 'REQ-000001' });
    expect(buildFeQrUrl('5001636863', 'FT FT6325S2C/1000020')).toBe(
      'https://quiosqueagt.minfin.gov.ao/facturacao-eletronica/consultar-fe?emissor=5001636863&document=FT%20FT6325S2C/1000020',
    );
    expect(formatFeDocumentNo('FT', 'FT6325S2C', 7)).toBe('FT FT6325S2C/7');
    expect(() => formatFeDocumentNo('FT', 'A', 1)).toThrow();
  });
});
