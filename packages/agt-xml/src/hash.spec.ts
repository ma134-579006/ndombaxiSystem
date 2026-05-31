import { GENESIS_HASH, computeDocumentHash, verifyChain } from './hash';
import { FiscalDocument } from './types';

function doc(number: string, gross: number): Pick<FiscalDocument, 'invoiceDate' | 'systemEntryDate' | 'number' | 'totals'> {
  return {
    invoiceDate: '2025-01-15',
    systemEntryDate: '2025-01-15T10:00:00',
    number,
    totals: { netTotal: gross, ivaTotal: 0, grossTotal: gross, byTaxCode: [] },
  };
}

describe('document hash chain', () => {
  it('is deterministic and 64 hex chars', () => {
    const h = computeDocumentHash(doc('FT A/2025/0001', 1000), GENESIS_HASH);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeDocumentHash(doc('FT A/2025/0001', 1000), GENESIS_HASH)).toBe(h);
  });

  it('changes when any field changes', () => {
    const base = computeDocumentHash(doc('FT A/2025/0001', 1000), GENESIS_HASH);
    expect(computeDocumentHash(doc('FT A/2025/0001', 1001), GENESIS_HASH)).not.toBe(base);
    expect(computeDocumentHash(doc('FT A/2025/0002', 1000), GENESIS_HASH)).not.toBe(base);
  });

  it('verifies a well-formed chain and rejects a tampered one', () => {
    const d1 = doc('FT A/2025/0001', 1000);
    const h1 = computeDocumentHash(d1, GENESIS_HASH);
    const d2 = doc('FT A/2025/0002', 2000);
    const h2 = computeDocumentHash(d2, h1);

    const chain = [
      { doc: d1, hash: h1, previousHash: GENESIS_HASH },
      { doc: d2, hash: h2, previousHash: h1 },
    ];
    expect(verifyChain(chain)).toBe(true);

    chain[1].previousHash = GENESIS_HASH; // break the link
    expect(verifyChain(chain)).toBe(false);
  });
});
