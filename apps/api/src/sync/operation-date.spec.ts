import { safeOperationDate } from './push.service';

describe('data da operação de vendas offline (M3)', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  it('aceita uma data real do último ano', () => expect(safeOperationDate('2026-11-18', now)).toBe('2026-11-18'));
  it.each(['1900-01-01', '2099-01-01', '2026-02-30', '21-11-2026', '', null, 42])('recusa %p', (v) => {
    expect(safeOperationDate(v, now)).toBeNull();
  });
});
