import { ForbiddenException } from '@nestjs/common';
import { DiscountGuardService } from './discount-guard.service';

/** Produto P1: 1000 Kz líquido, IVA 14 % → 1140 Kz bruto. */
function makeGuard(opts: { promoDiscount?: number; managers?: { id: string; name: string; pin: string }[] } = {}) {
  const audit: { action: string; details: unknown }[] = [];
  const managers = opts.managers ?? [];
  let call = 0;
  const prisma = {
    runInTenant: (_s: string, fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: () => {
          call += 1;
          // 1.ª consulta: produtos; 2.ª: candidatos a aprovar (supervisores/gerentes).
          return Promise.resolve(call === 1
            ? [{ id: 'p1', code: 'P1', category_id: null, unit_price: '1000', iva_code: 'NOR' }]
            : managers.map((m) => ({ id: m.id, name: m.name, pin_hash: `hash:${m.pin}` })));
        },
      }),
  };
  const promotions = {
    quote: (_s: string, lines: { productId: string; unitGross: number; quantity: number }[]) => Promise.resolve({
      lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, grossBefore: l.unitGross * l.quantity, discount: (opts.promoDiscount ?? 0) * l.unitGross * l.quantity, grossAfter: 0 })),
    }),
  };
  const passwords = { verify: (hash: string, pin: string) => Promise.resolve(hash === `hash:${pin}`) };
  const auditSvc = { record: (_s: string, e: { action: string; details: unknown }) => { audit.push(e); return Promise.resolve(); } };
  const guard = new DiscountGuardService(prisma as never, promotions as never, passwords as never, auditSvc as never);
  return { guard, audit };
}

const cashier = { sub: 'u1', role: 'CASHIER', storeId: null, name: 'Caixa' } as never;
const supervisor = { sub: 'u2', role: 'SHIFT_SUPERVISOR', storeId: null, name: 'Sup' } as never;

describe('DiscountGuardService', () => {
  it('aceita o desconto da promoção ativa sem aprovação', async () => {
    const { guard, audit } = makeGuard({ promoDiscount: 0.1 });
    await expect(guard.check('t', cashier, [{ productCode: 'P1', quantity: 2, discountRate: 0.1 }], {})).resolves.toBeUndefined();
    expect(audit).toHaveLength(0);
  });

  it('recusa desconto manual de um caixa sem PIN de aprovação', async () => {
    const { guard } = makeGuard();
    await expect(guard.check('t', cashier, [{ productCode: 'P1', quantity: 1, discountRate: 0.5 }], {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa PIN errado e aceita o PIN de um supervisor (auditado com o aprovador)', async () => {
    const { guard, audit } = makeGuard({ managers: [{ id: 'm1', name: 'Gerente Ana', pin: '4321' }] });
    const line = [{ productCode: 'P1', quantity: 1, discountRate: 0.2 }];
    await expect(guard.check('t', cashier, line, { approvalPin: '0000' })).rejects.toBeInstanceOf(ForbiddenException);
    await guard.check('t', cashier, line, { approvalPin: '4321' });
    expect(audit[0].action).toBe('MANUAL_DISCOUNT');
    expect(audit[0].details).toMatchObject({ approvedBy: { id: 'm1', name: 'Gerente Ana' } });
  });

  it('supervisor dá desconto manual sem PIN (fica auditado)', async () => {
    const { guard, audit } = makeGuard();
    await guard.check('t', supervisor, [{ productCode: 'P1', quantity: 1, discountRate: 0.3 }], {});
    expect(audit[0]).toMatchObject({ action: 'MANUAL_DISCOUNT', details: { approvedBy: 'self' } });
  });

  it('venda offline não é recusada, mas fica auditada como não verificada', async () => {
    const { guard, audit } = makeGuard();
    await guard.check('t', cashier, [{ productCode: 'P1', quantity: 1, discountRate: 0.4 }], { offline: true });
    expect(audit[0].action).toBe('MANUAL_DISCOUNT_UNVERIFIED');
  });
});
