import { AffiliatesService, stateOf } from './affiliates.service';

describe('programa de associados (LPS Kwanza)', () => {
  it('comissão só fica disponível quando a encomenda é entregue', () => {
    expect(stateOf('DELIVERED')).toBe('AVAILABLE');
    expect(stateOf('CANCELLED')).toBe('CANCELLED');
    for (const s of ['PENDING', 'PAID', 'SHIPPED']) expect(stateOf(s)).toBe('PENDING');
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
