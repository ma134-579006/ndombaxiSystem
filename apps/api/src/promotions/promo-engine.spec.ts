import { applyPromotions, isPromoActive, type Promotion, type PromoCartLine } from './promo-engine';
import { DEFAULT_LOYALTY, pointsEarned, redeemPoints } from './loyalty-engine';

const line = (over: Partial<PromoCartLine> = {}): PromoCartLine => ({
  productId: 'p1', categoryId: 'c1', unitGross: 1000, quantity: 1, ...over,
});

describe('promo-engine — PERCENT', () => {
  it('aplica X% ao produto-alvo', () => {
    const promos: Promotion[] = [{ id: '1', name: '10% café', type: 'PERCENT', scope: 'PRODUCT', targetId: 'p1', percent: 10 }];
    const r = applyPromotions([line({ quantity: 2 })], promos);
    expect(r.totalBefore).toBe(2000);
    expect(r.totalDiscount).toBe(200);
    expect(r.totalAfter).toBe(1800);
    expect(r.lines[0].appliedPromo?.name).toBe('10% café');
  });
  it('não aplica a produto fora do alvo', () => {
    const promos: Promotion[] = [{ id: '1', name: 'x', type: 'PERCENT', scope: 'PRODUCT', targetId: 'OUTRO', percent: 10 }];
    expect(applyPromotions([line()], promos).totalDiscount).toBe(0);
  });
});

describe('promo-engine — BUY_X_PAY_Y (3x2)', () => {
  it('1 grupo de 3 → 1 grátis', () => {
    const promos: Promotion[] = [{ id: '1', name: 'Leve 3 paga 2', type: 'BUY_X_PAY_Y', scope: 'ALL', buyQty: 3, payQty: 2 }];
    const r = applyPromotions([line({ quantity: 3, unitGross: 500 })], promos);
    expect(r.totalDiscount).toBe(500); // 1 unidade grátis
    expect(r.totalAfter).toBe(1000);
  });
  it('7 unidades → 2 grátis (2 grupos completos)', () => {
    const promos: Promotion[] = [{ id: '1', name: '3x2', type: 'BUY_X_PAY_Y', scope: 'ALL', buyQty: 3, payQty: 2 }];
    const r = applyPromotions([line({ quantity: 7, unitGross: 500 })], promos);
    expect(r.totalDiscount).toBe(1000); // floor(7/3)=2 grupos × 1 grátis
  });
});

describe('promo-engine — QTY_TIERED', () => {
  it('aplica só a partir do mínimo', () => {
    const promos: Promotion[] = [{ id: '1', name: 'Atacado', type: 'QTY_TIERED', scope: 'ALL', minQty: 10, tierPercent: 5 }];
    expect(applyPromotions([line({ quantity: 5, unitGross: 100 })], promos).totalDiscount).toBe(0);
    expect(applyPromotions([line({ quantity: 10, unitGross: 100 })], promos).totalDiscount).toBe(50);
  });
});

describe('promo-engine — melhor promoção por linha (sem acumular)', () => {
  it('escolhe o maior desconto', () => {
    const promos: Promotion[] = [
      { id: '1', name: '5%', type: 'PERCENT', scope: 'ALL', percent: 5 },
      { id: '2', name: '20%', type: 'PERCENT', scope: 'PRODUCT', targetId: 'p1', percent: 20 },
    ];
    const r = applyPromotions([line({ quantity: 1, unitGross: 1000 })], promos);
    expect(r.totalDiscount).toBe(200);
    expect(r.lines[0].appliedPromo?.name).toBe('20%');
  });
  it('o desconto nunca ultrapassa o valor da linha', () => {
    const promos: Promotion[] = [{ id: '1', name: 'absurdo', type: 'AMOUNT', scope: 'ALL', amount: 99999 }];
    const r = applyPromotions([line({ quantity: 1, unitGross: 1000 })], promos);
    expect(r.totalDiscount).toBe(1000);
    expect(r.totalAfter).toBe(0);
  });
});

describe('promo-engine — janelas (happy-hour / dias / datas)', () => {
  const base: Promotion = { id: '1', name: 'hh', type: 'PERCENT', scope: 'ALL', percent: 10 };
  it('respeita o intervalo horário', () => {
    const p = { ...base, startTime: '14:00', endTime: '16:00' };
    expect(isPromoActive(p, new Date('2026-06-01T15:00:00'))).toBe(true);
    expect(isPromoActive(p, new Date('2026-06-01T17:00:00'))).toBe(false);
  });
  it('respeita os dias da semana', () => {
    const seg = new Date('2026-06-01T10:00:00'); // 2026-06-01 é segunda (getDay 1)
    expect(isPromoActive({ ...base, weekdays: [1] }, seg)).toBe(true);
    expect(isPromoActive({ ...base, weekdays: [0] }, seg)).toBe(false);
  });
  it('respeita o intervalo de datas e o active=false', () => {
    expect(isPromoActive({ ...base, endsAt: '2026-01-01T00:00:00Z' }, new Date('2026-06-01T10:00:00Z'))).toBe(false);
    expect(isPromoActive({ ...base, active: false })).toBe(false);
  });
});

describe('loyalty-engine', () => {
  it('ganha pontos por Kwanza (1 por 100 Kz)', () => {
    expect(pointsEarned(10000, DEFAULT_LOYALTY)).toBe(100);
    expect(pointsEarned(50, DEFAULT_LOYALTY)).toBe(0);
  });
  it('resgate limitado pelos pontos disponíveis', () => {
    const r = redeemPoints(1000, 200, 5000, DEFAULT_LOYALTY);
    expect(r.pointsUsed).toBe(200);
    expect(r.discountKz).toBe(100); // 200 × 0,5
  });
  it('resgate limitado pelo tecto da compra (50%)', () => {
    // compra 1000 → tecto 500 Kz → 1000 pontos máx; disponível 5000
    const r = redeemPoints(5000, 5000, 1000, DEFAULT_LOYALTY);
    expect(r.discountKz).toBe(500);
    expect(r.pointsUsed).toBe(1000);
  });
});
