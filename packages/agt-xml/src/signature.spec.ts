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
