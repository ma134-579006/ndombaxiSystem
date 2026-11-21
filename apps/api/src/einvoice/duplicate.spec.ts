import { COMMUNICATION_BLOCK_DAYS, isDuplicateOnly } from './einvoice.service';

describe('E09 — documento já registado na AGT', () => {
  it('só E09 (qualquer formato de campo) → duplicado', () => {
    expect(isDuplicateOnly([{ errorCode: 'E09' }])).toBe(true);
    expect(isDuplicateOnly([{ idError: 'E09' }, { code: 'E09' }])).toBe(true);
  });
  it('E09 com outro erro, lista vazia ou nada → não é só duplicado', () => {
    expect(isDuplicateOnly([{ errorCode: 'E09' }, { errorCode: 'E20' }])).toBe(false);
    expect(isDuplicateOnly([])).toBe(false);
    expect(isDuplicateOnly(undefined)).toBe(false);
  });
  it('bloqueio do art. 17.º do DP 71/25 = 60 dias', () => expect(COMMUNICATION_BLOCK_DAYS).toBe(60));
});
