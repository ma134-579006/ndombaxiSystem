import { readVendusPlan, vendusSubscriptionPeriod } from './fiscal-engine.policy';

describe('Subscrição Vendus (anel "Renovar subscrição")', () => {
  it('conta como o backoffice Vendus: fim 21/12, hoje 24/11 → faltam 27 dias, 13%', () => {
    const p = vendusSubscriptionPeriod('2026-12-21', new Date('2026-11-24T12:00:00+01:00'))!;
    expect(p.active).toBe(true);
    expect(p.daysLeft).toBe(27);
    expect(p.totalDays).toBe(30);
    expect(p.pct).toBe(13);
  });
  it('arredonda a % para baixo como o Vendus: fim 21/12, hoje 25/11 → faltam 26 dias, 16%', () => {
    const p = vendusSubscriptionPeriod('2026-12-21', new Date('2026-11-25T10:00:00+01:00'))!;
    expect(p.daysLeft).toBe(26);
    expect(p.pct).toBe(16);
  });
  it('aceita a data com hora e no formato dd/mm/aaaa', () => {
    expect(vendusSubscriptionPeriod('2026-12-21 23:59:59', new Date('2026-11-24T12:00:00+01:00'))!.daysLeft).toBe(27);
    expect(vendusSubscriptionPeriod('21/12/2026', new Date('2026-11-24T12:00:00+01:00'))!.daysLeft).toBe(27);
  });
  it('plano anual quando o fim está a mais de 40 dias', () => {
    const p = vendusSubscriptionPeriod('2027-06-01', new Date('2026-11-24T12:00:00+01:00'))!;
    expect(p.totalDays).toBe(365);
  });
  it('expirada → inactiva, 100%', () => {
    const p = vendusSubscriptionPeriod('2026-11-01', new Date('2026-11-24T12:00:00+01:00'))!;
    expect(p.active).toBe(false);
    expect(p.pct).toBe(100);
  });
  it('data inválida → null', () => { expect(vendusSubscriptionPeriod('')).toBeNull(); expect(vendusSubscriptionPeriod('sem data')).toBeNull(); });
  it('lê plano, fim e subdomínio da conta quando existem', () => {
    expect(readVendusPlan({ id: 1, plan: 'Pro', subscription_expires: '2026-12-21', url: 'https://loja-da-mulher-4.vendus.co.ao' }))
      .toEqual({ plan: 'Pro', expires: '2026-12-21', subdomain: 'loja-da-mulher-4' });
    expect(readVendusPlan({ id: 1, company: 'X' })).toEqual({ plan: '', expires: '', subdomain: '' });
  });
});
