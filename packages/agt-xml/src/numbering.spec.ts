import { DocumentType } from './document-types';
import { formatDocumentNumber, parseDocumentNumber } from './numbering';

describe('document numbering', () => {
  it('formats with zero-padded sequence', () => {
    expect(
      formatDocumentNumber({ type: DocumentType.FT, series: 'A', year: 2025, sequence: 1 }),
    ).toBe('FT A/2025/0001');
    expect(
      formatDocumentNumber({ type: DocumentType.NC, series: 'B2', year: 2025, sequence: 12345 }),
    ).toBe('NC B2/2025/12345');
  });

  it('round-trips through parse', () => {
    const n = 'FT A/2025/0042';
    expect(formatDocumentNumber(parseDocumentNumber(n))).toBe(n);
  });

  it('rejects invalid series and sequence', () => {
    expect(() =>
      formatDocumentNumber({ type: DocumentType.FT, series: 'a-b', year: 2025, sequence: 1 }),
    ).toThrow(/series/);
    expect(() =>
      formatDocumentNumber({ type: DocumentType.FT, series: 'A', year: 2025, sequence: 0 }),
    ).toThrow(/sequence/);
  });

  it('rejects malformed numbers and unknown types on parse', () => {
    expect(() => parseDocumentNumber('FT/2025/1')).toThrow(/Malformed/);
    expect(() => parseDocumentNumber('XX A/2025/0001')).toThrow(/Unknown document type/);
  });
});
