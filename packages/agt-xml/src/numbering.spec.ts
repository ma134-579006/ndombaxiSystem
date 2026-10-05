import { DocumentType } from './document-types';
import { formatDocumentNumber, parseDocumentNumber } from './numbering';

describe('document numbering', () => {
  it('formats with zero-padded sequence', () => {
    expect(
      formatDocumentNumber({ type: DocumentType.FT, series: 'A', year: 2025, sequence: 1 }),
    ).toBe('FT A2025/0001');
    expect(
      formatDocumentNumber({ type: DocumentType.NC, series: 'B2', year: 2025, sequence: 12345 }),
    ).toBe('NC B22025/12345');
  });

  it('round-trips through parse', () => {
    const n = 'FT A2025/0042';
    expect(formatDocumentNumber(parseDocumentNumber(n))).toBe(n);
    expect(parseDocumentNumber('NC B22025/12345')).toMatchObject({ series: 'B2', year: 2025, sequence: 12345 });
    // legado
    expect(parseDocumentNumber('FT A/2025/0042')).toMatchObject({ series: 'A', year: 2025, sequence: 42 });
    // padrão oficial AGT do InvoiceNo
    expect(n).toMatch(/^[^ ]+ [^/^ ]+\/[0-9]+$/);
  });

  it('rejects invalid series and sequence', () => {
    expect(() =>
      formatDocumentNumber({ type: DocumentType.FT, series: 'a-b', year: 2025, sequence: 1 }),
    ).toThrow(/series/);
    expect(() =>
      formatDocumentNumber({ type: DocumentType.FT, series: 'A', year: 2025, sequence: 0 }),
    ).toThrow(/sequence/);
  });

  it('factura-recibo (interno FS) numera-se com o código AGT FR', () => {
    const n = formatDocumentNumber({ type: DocumentType.FS, series: 'A', year: 2026, sequence: 3 });
    expect(n).toBe('FR A2026/0003');
    expect(parseDocumentNumber(n).type).toBe(DocumentType.FS);
  });

  it('rejects malformed numbers and unknown types on parse', () => {
    expect(() => parseDocumentNumber('FT/2025/1')).toThrow(/Malformed/);
    expect(() => parseDocumentNumber('XX A2025/0001')).toThrow(/Unknown document type/);
  });
});
