import { AffiliatesService, stateOf } from './affiliates.service';

describe('programa de associados (LPS Kwanza)', () => {
  it('comissão fica disponível quando a empresa marca a encomenda como vendida', () => {
    for (const s of ['PAID', 'SHIPPED', 'DELIVERED']) expect(stateOf(s)).toBe('AVAILABLE');
    expect(stateOf('CANCELLED')).toBe('CANCELLED');
    expect(stateOf('PENDING')).toBe('PENDING');
  });
  it('código inválido não toca na base de dados', async () => {
    const runInTenant = jest.fn();
    const svc = new AffiliatesService({ runInTenant } as never);
    await svc.attribute('t', 'o', 'abc', null);
    await svc.attribute('t', 'o', undefined, null);
    await svc.attribute('t', 'o', 'ABC-12', null);
    expect(runInTenant).not.toHaveBeenCalled();
  });
});
