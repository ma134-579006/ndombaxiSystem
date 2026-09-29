import { GENESIS_HASH, computeDocumentHash } from './hash';
import {
  RSA_MODULUS_LENGTH,
  RsaDocumentSigner,
  generateSigningKeyPair,
  signString,
  verifySignatureString,
} from './signature';
import { FiscalDocument } from './types';

function doc(
  number: string,
  gross: number,
): Pick<FiscalDocument, 'invoiceDate' | 'systemEntryDate' | 'number' | 'totals'> {
  return {
    invoiceDate: '2025-01-15',
    systemEntryDate: '2025-01-15T10:00:00',
    number,
    totals: { netTotal: gross, ivaTotal: 0, grossTotal: gross, byTaxCode: [] },
  };
}

describe('RSA-2048 fiscal signature', () => {
  // Gera uma vez (a geração de chaves é cara) e reutiliza nos testes.
  const keys = generateSigningKeyPair();

  it('generates a PEM RSA-2048 key pair', () => {
    expect(keys.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(keys.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    // RSA-2048 → módulo de 256 bytes; a chave pública SPKI ronda os 400+ chars base64.
    expect(RSA_MODULUS_LENGTH).toBe(2048);
  });

  it('signs and verifies a string', () => {
    const sig = signString('FT A/2025/0001;1000.00', keys.privateKeyPem);
    expect(verifySignatureString('FT A/2025/0001;1000.00', sig, keys.publicKeyPem)).toBe(true);
  });

  it('rejects a tampered message or wrong key', () => {
    const sig = signString('original', keys.privateKeyPem);
    expect(verifySignatureString('tampered', sig, keys.publicKeyPem)).toBe(false);

    const other = generateSigningKeyPair();
    expect(verifySignatureString('original', sig, other.publicKeyPem)).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifySignatureString('x', 'not-base64-sig!!', keys.publicKeyPem)).toBe(false);
  });

  it('RsaDocumentSigner produces a hash equal to the SHA-256 chain plus a verifiable signature', () => {
    const signer = new RsaDocumentSigner({ privateKeyPem: keys.privateKeyPem, keyVersion: 1 });
    const d = doc('FT WEB/2025/0001', 2500);

    const result = signer.signDocument(d, GENESIS_HASH);

    // A cadeia de integridade mantém-se SHA-256.
    expect(result.hash).toBe(computeDocumentHash(d, GENESIS_HASH));
    expect(result.keyVersion).toBe(1);
    expect(result.algorithm).toBe('RSA-SHA256');

    // A assinatura digital é válida sobre a mesma signable string.
    expect(verifySignatureString(result.signableString, result.signature, keys.publicKeyPem)).toBe(
      true,
    );
  });

  it('signature changes when the document changes', () => {
    const signer = new RsaDocumentSigner({ privateKeyPem: keys.privateKeyPem, keyVersion: 1 });
    const a = signer.signDocument(doc('FT A/2025/0001', 1000), GENESIS_HASH);
    const b = signer.signDocument(doc('FT A/2025/0002', 1000), GENESIS_HASH);
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('Modelo AGT (Modelo 8): RSA-1024 / SHA-1, assinatura de 172 caracteres', () => {
  const {
    AgtDocumentSigner, buildAgtSignableString, isAgtSignature, verifyAgtDocument, generateSigningKeyPair, RSA_DOC_MODULUS_LENGTH,
  } = require('./signature');
  const keys = generateSigningKeyPair(RSA_DOC_MODULUS_LENGTH);
  const header = (number: string, gross: number, entry = '2026-09-29T11:27:08.456Z') => ({
    invoiceDate: '2026-09-29', systemEntryDate: entry, number,
    totals: { netTotal: gross, ivaTotal: 0, grossTotal: gross, byTaxCode: [] },
  });

  it('texto a assinar: datas AGT, GrossTotal com 2 casas e hash anterior vazio no 1.º', () => {
    expect(buildAgtSignableString(header('FT A2026/0001', 1200), '')).toBe(
      '2026-09-29;2026-09-29T11:27:08;FT A2026/0001;1200.00;',
    );
  });

  it('assina com 172 caracteres Base64 e verifica com a chave pública', () => {
    const signer = new AgtDocumentSigner({ privateKeyPem: keys.privateKeyPem, keyVersion: 1 });
    const d1 = header('FT A2026/0001', 1200);
    const s1 = signer.signDocument(d1, '');
    expect(s1.signature).toHaveLength(172);
    expect(isAgtSignature(s1.signature)).toBe(true);
    expect(verifyAgtDocument(d1, '', s1.signature, keys.publicKeyPem)).toBe(true);
    // o documento seguinte encadeia com a ASSINATURA do anterior
    const d2 = header('FT A2026/0002', 75.5, '2026-09-29T11:43:25.000Z');
    const s2 = signer.signDocument(d2, s1.signature);
    expect(verifyAgtDocument(d2, s1.signature, s2.signature, keys.publicKeyPem)).toBe(true);
    expect(verifyAgtDocument(d2, '', s2.signature, keys.publicKeyPem)).toBe(false);
    expect(verifyAgtDocument(header('FT A2026/0002', 75.6), s1.signature, s2.signature, keys.publicKeyPem)).toBe(false);
  });

  it('recusa chave de 2048 bits (assinatura de 344 caracteres não cabe no Hash)', () => {
    const big = generateSigningKeyPair(2048);
    const signer = new AgtDocumentSigner({ privateKeyPem: big.privateKeyPem, keyVersion: 1 });
    expect(() => signer.signDocument(header('FT A2026/0001', 1), '')).toThrow(/1024/);
  });
});
