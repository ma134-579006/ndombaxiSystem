import { agtStateFromDetails, companyReadiness, dueAlerts, effectiveEngine, providerValidity, type CompanyLike, type SettingsLike } from './fiscal-engine.policy';
import { buildCreditNote, buildSaleDocument, totalsDivergence, vendusTypeFor, type SaleSnapshot } from './vendus-payload';
import { classifyStatus, VendusClient, type FetchLike } from './vendus.client';

const NOW = new Date('2026-11-21T10:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

function settings(over: Partial<SettingsLike> = {}): SettingsLike {
  return {
    vendusEnabled: true,
    providerProducer: 'PRIMAVERA- BUSINESS SOFTWARE SOLUTIONS, LDA',
    providerSoftware: 'Vendus',
    providerValidationNo: '142/AGT/2019',
    providerVersion: '1',
    providerFeCertNo: 'FE/105/AGT/2025',
    providerValidUntil: d('2026-12-16'),
    providerEvidenceUrl: 'https://www.ucm.minfin.gov.ao/x.pdf',
    providerEvidenceId: null,
    providerVerifiedAt: NOW,
    providerVerifiedBy: 'Super Admin',
    alertDays: [30, 15, 7, 0],
    alertsSent: {},
    lpsValidationNo: '',
    lpsValidationVersion: '',
    lpsEvidenceId: null,
    lpsTestsApprovedAt: null,
    lpsConfirmedAt: null,
    lpsConfirmedBy: '',
    ...over,
  };
}

function company(over: Partial<CompanyLike> = {}): CompanyLike {
  return {
    engine: 'VENDUS',
    suspendedReason: '',
    apiKeyEnc: 'v1:x',
    apiKeySetAt: d('2026-11-01'),
    accountId: '77',
    accountFiscalId: '5417000123',
    accountCountry: 'AO',
    registerId: '9',
    registerSubscription: 'yes',
    feConfirmedAt: NOW,
    lastTestAt: NOW,
    lastTestOk: true,
    lastTestCode: 'OK',
    testsPassedAt: NOW,
    activatedAt: NOW,
    paymentMap: { CASH: '3' },
    ...over,
  };
}

describe('validade da validação AGT do fornecedor', () => {
  it('confirmada com todos os dados e evidência', () => {
    expect(providerValidity(settings(), NOW)).toEqual({ status: 'CONFIRMADO', daysLeft: 25, missing: [] });
  });
  it('sem data de validade → pendente (nunca assumida)', () => {
    const v = providerValidity(settings({ providerValidUntil: null }), NOW);
    expect(v.status).toBe('PENDENTE');
    expect(v.missing).toContain('data de validade');
  });
  it('sem evidência → pendente', () => {
    expect(providerValidity(settings({ providerEvidenceUrl: '' }), NOW).status).toBe('PENDENTE');
  });
  it('no dia do vencimento ainda vale; no dia seguinte expira', () => {
    expect(providerValidity(settings(), new Date('2026-12-16T12:00:00Z')).status).toBe('CONFIRMADO');
    expect(providerValidity(settings(), new Date('2026-12-17T12:00:00Z')).status).toBe('EXPIRADO');
  });
  it('alertas 30/15/7/0: só o limiar mais próximo e uma vez', () => {
    expect(dueAlerts(settings(), NOW)).toEqual([{ key: '2026-12-16:30', days: 30 }]);
    expect(dueAlerts(settings({ alertsSent: { '2026-12-16:30': 'x' } }), NOW)).toEqual([]);
    expect(dueAlerts(settings(), new Date('2026-12-10T10:00:00Z'))).toEqual([{ key: '2026-12-16:7', days: 7 }]);
    expect(dueAlerts(settings(), new Date('2026-12-16T10:00:00Z'))).toEqual([{ key: '2026-12-16:0', days: 0 }]);
  });
});

describe('motor efectivo (sem passagem automática para o LPS)', () => {
  const nif = '5417000123';
  it('Vendus activo e tudo verificado → VENDUS', () => {
    expect(effectiveEngine(company(), settings(), nif, NOW).engine).toBe('VENDUS');
  });
  it('validade expirada → SUSPENSO (nunca LPS), mesmo com o switch ligado', () => {
    const e = effectiveEngine(company(), settings({ vendusEnabled: true }), nif, new Date('2026-12-20T10:00:00Z'));
    expect(e.engine).toBe('SUSPENSO');
    expect(e.reason).toMatch(/expirada/);
  });
  it('chave inválida (teste falhado) → SUSPENSO', () => {
    expect(effectiveEngine(company({ lastTestOk: false, lastTestCode: 'CHAVE_INVALIDA' }), settings(), nif, NOW).engine).toBe('SUSPENSO');
  });
  it('subscrição inactiva → SUSPENSO', () => {
    expect(effectiveEngine(company({ registerSubscription: 'no' }), settings(), nif, NOW).engine).toBe('SUSPENSO');
  });
  it('conta de outro NIF → SUSPENSO', () => {
    expect(effectiveEngine(company({ accountFiscalId: '5000000001' }), settings(), nif, NOW).engine).toBe('SUSPENSO');
  });
  it('switch desligado → SUSPENSO', () => {
    expect(effectiveEngine(company(), settings({ vendusEnabled: false }), nif, NOW).engine).toBe('SUSPENSO');
  });
  it('empresa sem ligação → LPS marcado como legado (sem validação própria)', () => {
    expect(effectiveEngine(null, settings(), nif, NOW)).toEqual({ engine: 'LPS', reason: 'Motor próprio sem validação AGT documentada', legacy: true });
  });
  it('suspensão explícita mantém o motivo', () => {
    expect(effectiveEngine(company({ engine: 'SUSPENSO', suspendedReason: 'Problema de segurança' }), settings(), nif, NOW)).toMatchObject({ engine: 'SUSPENSO', reason: 'Problema de segurança' });
  });
});

describe('indicadores e activação', () => {
  const nif = '5417000123';
  it('sem chave → credenciais por inserir; não activa', () => {
    const r = companyReadiness(company({ apiKeyEnc: null, engine: 'LPS', activatedAt: null }), settings(), nif, NOW);
    expect(r.indicator).toBe('CREDENCIAIS_POR_INSERIR');
    expect(r.canActivate).toBe(false);
  });
  it('chave trocada depois do último teste → ligação não testada', () => {
    const r = companyReadiness(company({ engine: 'LPS', activatedAt: null, apiKeySetAt: new Date(NOW.getTime() + 1000) }), settings(), nif, NOW);
    expect(r.indicator).toBe('LIGACAO_NAO_TESTADA');
  });
  it('FE do Vendus por confirmar → configuração fiscal pendente', () => {
    expect(companyReadiness(company({ engine: 'LPS', activatedAt: null, feConfirmedAt: null }), settings(), nif, NOW).indicator).toBe('CONFIGURACAO_FISCAL_PENDENTE');
  });
  it('validade por confirmar → certificação por confirmar', () => {
    expect(companyReadiness(company({ engine: 'LPS', activatedAt: null }), settings({ providerEvidenceUrl: '' }), nif, NOW).indicator).toBe('CERTIFICACAO_POR_CONFIRMAR');
  });
  it('sem testes → testes pendentes', () => {
    expect(companyReadiness(company({ engine: 'LPS', activatedAt: null, testsPassedAt: null }), settings(), nif, NOW).indicator).toBe('TESTES_PENDENTES');
  });
  it('tudo verificado → pronto; activo → motor activo; expirado depois de activo → suspensa', () => {
    expect(companyReadiness(company({ engine: 'LPS', activatedAt: null }), settings(), nif, NOW)).toMatchObject({ indicator: 'PRONTO_PARA_ACTIVACAO', canActivate: true });
    expect(companyReadiness(company(), settings(), nif, NOW).indicator).toBe('MOTOR_ACTIVO');
    expect(companyReadiness(company(), settings(), nif, new Date('2026-12-20T10:00:00Z')).indicator).toBe('INTEGRACAO_SUSPENSA');
  });
});

describe('estado AGT nunca deduzido da resposta HTTP', () => {
  it('detalhe com hash, QR e PDF → só COMUNICACAO_AGT_PENDENTE', () => {
    expect(agtStateFromDetails({ id: 1, hash: 'abc', qrcode: '<svg/>', agt: { document_number: 'FT X/1', qrcode_image: 'x' } }, 'normal')).toBe('COMUNICACAO_AGT_PENDENTE');
  });
  it('modo testes → CRIADO_NO_VENDUS (sem validade fiscal)', () => {
    expect(agtStateFromDetails({ id: 1 }, 'tests')).toBe('CRIADO_NO_VENDUS');
  });
  it('sem detalhe → desconhecido', () => {
    expect(agtStateFromDetails(null, 'normal')).toBe('ESTADO_DESCONHECIDO');
  });
});

const sale = (over: Partial<SaleSnapshot> = {}): SaleSnapshot => ({
  invoiceId: 'i1', internalNumber: 'FT VND2026/0001', docType: 'FT', paymentType: 'CASH', grossTotal: 1140,
  customer: { id: 'c1', taxId: '5417000123', name: 'Cliente Lda' },
  lines: [{ productCode: 'P1', description: 'Sabão', quantity: 2, unitPrice: 500, ivaCode: 'NOR', ivaRate: 14, discountRate: 0, grossAmount: 1140 }],
  ...over,
});
const maps = { registerId: '9', taxMap: { NOR: 'NOR', ISE: 'ISE' }, exemptions: ['M10'], paymentMap: { CASH: '3' } };
const op = { txId: 'lps-i1-FT', externalReference: 'LPS-i1', mode: 'normal' as const };

describe('corpo de POST /documents/', () => {
  it('venda paga → FR com tx_id, external_reference, cliente AO e pagamento mapeado', () => {
    const r = buildSaleDocument(sale(), maps, op);
    expect(r.errors).toEqual([]);
    expect(r.body).toMatchObject({ type: 'FR', register_id: 9, tx_id: 'lps-i1-FT', external_reference: 'LPS-i1', mode: 'normal', client: { fiscal_id: '5417000123', country: 'AO' }, payments: [{ id: '3', amount: '1140.00' }] });
    expect((r.body!.items as any[])[0]).toMatchObject({ reference: 'P1', qty: 2, gross_price: '570.00', tax_id: 'NOR' });
  });
  it('venda a crédito → FT sem pagamentos', () => {
    const r = buildSaleDocument(sale({ paymentType: 'CREDIT' }), maps, op);
    expect(r.body).toMatchObject({ type: 'FT' });
    expect(r.body!.payments).toBeUndefined();
    expect(vendusTypeFor({ paymentType: 'FS' })).toBe('FR');
  });
  it('consumidor final 999999990 nunca é enviado como cliente', () => {
    expect(buildSaleDocument(sale({ customer: { taxId: '999999990', name: 'Consumidor final' } }), maps, op).body!.client).toBeUndefined();
  });
  it('imposto sem correspondência confirmada → erro (não assume equivalência)', () => {
    const r = buildSaleDocument(sale({ lines: [{ ...sale().lines[0], ivaCode: 'INT', ivaRate: 7 }] }), maps, op);
    expect(r.body).toBeUndefined();
    expect(r.errors.join()).toMatch(/INT sem correspondência/);
  });
  it('isenção com motivo inexistente na conta → erro', () => {
    const r = buildSaleDocument(sale({ lines: [{ ...sale().lines[0], ivaCode: 'ISE', ivaRate: 0, exemptionCode: 'M99' }] }), maps, op);
    expect(r.errors.join()).toMatch(/M99 não existe/);
  });
  it('quantidade fraccionária → erro (qty integer na v1.1)', () => {
    expect(buildSaleDocument(sale({ lines: [{ ...sale().lines[0], quantity: 1.5 }] }), maps, op).errors.join()).toMatch(/inteiras/);
  });
  it('NC referencia documento e linha de origem com motivo', () => {
    const r = buildCreditNote({ sourceVendusNumber: 'FR AO2026/12', reason: 'Devolução', lines: [{ row: 1, vendusItemId: 55, reference: 'P1', quantity: 1 }] }, maps, { ...op, txId: 'lps-n1-NC' });
    expect(r.body).toMatchObject({ type: 'NC', notes: 'Devolução', items: [{ id: 55, qty: 1, reference_document: { document_number: 'FR AO2026/12', document_row: 1 } }] });
  });
  it('divergência de totais assinalada', () => {
    expect(totalsDivergence(1140, '1140.00')).toBeNull();
    expect(totalsDivergence(1140, '1139.99')).toMatch(/diferença 0.01/);
  });
});

describe('cliente da API Vendus', () => {
  const fake = (status: number, body: string, headers: Record<string, string> = {}): FetchLike => async (url, init) => {
    (fake as any).last = { url, init };
    return { status, headers: { get: (n: string) => headers[n] ?? null }, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer };
  };
  it('chave no cabeçalho Bearer, nunca no URL; versão no caminho', async () => {
    let seen: any;
    const f: FetchLike = async (url, init) => { seen = { url, init }; return { status: 200, headers: { get: () => null }, text: async () => '{"id":1}', arrayBuffer: async () => new ArrayBuffer(0) }; };
    const c = new VendusClient({ baseUrl: 'https://www.vendus.co.ao/ws', version: '1.1', apiKey: 'SEGREDO-123456789', fetchImpl: f });
    await c.account();
    expect(seen.url).toBe('https://www.vendus.co.ao/ws/v1.1/account/');
    expect(seen.url).not.toContain('SEGREDO');
    expect(seen.init.headers.Authorization).toBe('Bearer SEGREDO-123456789');
  });
  it('classifica 401/403/422/429/5xx', async () => {
    expect(classifyStatus(401, {})).toBe('CHAVE_INVALIDA');
    expect(classifyStatus(403, { message: 'Subscrição expirada' })).toBe('SUBSCRICAO_INACTIVA');
    expect(classifyStatus(403, { message: 'Forbidden' })).toBe('SEM_PERMISSAO');
    expect(classifyStatus(422, {})).toBe('VALIDACAO');
    expect(classifyStatus(429, {})).toBe('LIMITE');
    expect(classifyStatus(503, {})).toBe('INDISPONIVEL');
    const c = new VendusClient({ baseUrl: 'https://x/ws', version: '1.1', apiKey: 'k'.repeat(20), fetchImpl: fake(422, '{"errors":[{"code":"A001","message":"items"}]}') });
    const r = await c.createDocument({});
    expect(r).toMatchObject({ ok: false, status: 422, error: { code: 'VALIDACAO', message: 'A001 items' } });
  });
  it('timeout → TIMEOUT (pode ter sido processado)', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const c = new VendusClient({ baseUrl: 'https://x/ws', version: '1.1', apiKey: 'k'.repeat(20), fetchImpl: hang, timeoutMs: 30 });
    expect((await c.createDocument({})).error?.code).toBe('TIMEOUT');
  });
  it('PDF que não é PDF → resposta inválida', async () => {
    const c = new VendusClient({ baseUrl: 'https://x/ws', version: '1.1', apiKey: 'k'.repeat(20), fetchImpl: fake(200, '<html>') });
    expect((await c.documentPdf('1')).error?.code).toBe('RESPOSTA_INVALIDA');
  });
  it('versão não publicada é recusada', () => {
    expect(() => new VendusClient({ baseUrl: 'https://x/ws', version: '2.0', apiKey: 'k' })).toThrow(/não suportada/);
  });
});

import { isAngola as isAO, readVendusAccount as readAcc, registerSubscriptionActive as subOk, sameNif as sameN } from './fiscal-engine.policy';
describe('forma real da resposta Vendus', () => {
  it('conta como objecto, lista ou envelope', () => {
    expect(readAcc({ id: 1, company: 'X', fiscal_id: '5417000123', country: 'AO' }).fiscalId).toBe('5417000123');
    expect(readAcc([{ id: 1, fiscal_id: '5417000123' }]).fiscalId).toBe('5417000123');
    expect(readAcc({ account: { id: 1, nif: '5417000123' } }).fiscalId).toBe('5417000123');
  });
  it('tax_id da conta (taxa) nunca é lido como NIF; sem NIF devolve os nomes dos campos', () => {
    const a = readAcc({ id: 1, company: 'X', tax_id: 'NOR' });
    expect(a.fiscalId).toBe('');
    expect(a.keys).toEqual(['id', 'company', 'tax_id']);
  });
  it('país e NIF tolerantes', () => {
    expect(isAO('Angola')).toBe(true);
    expect(isAO('AO')).toBe(true);
    expect(isAO('PT')).toBe(false);
    expect(sameN('AO 541-700-0123', '5417000123')).toBe(true);
    expect(sameN('', '')).toBe(false);
  });
  it('subscrição da caixa por valor sim/não ou por data', () => {
    expect(subOk({ subscription_active: 'yes' }).active).toBe(true);
    expect(subOk({ subscription_active: 'no' }).active).toBe(false);
    expect(subOk({ subscription_active: '2099-01-01' }).active).toBe(true);
    expect(subOk({ subscription_active: '2000-01-01' }).active).toBe(false);
  });
});

import { vendusErrorMessage as vem } from './vendus.client';
describe('mensagens de erro do Vendus', () => {
  it('message como objecto (errors_full) fica legível', () => {
    expect(vem({ errors: [{ code: 'A001', message: { items: 'Product reference not found', register_id: 'invalid' } }] }, 'x')).toBe('A001 items: Product reference not found; register_id: invalid');
    expect(vem({ errors: [{ code: 'A001', message: ['a', { b: 'c' }] }] }, 'x')).toBe('A001 a; b: c');
    expect(vem({ errors: [{ code: 'A001', message: 'AUTH' }] }, 'x')).toBe('A001 AUTH');
  });
});

describe('Factura-Recibo exige pagamento (FR_HAVE_TO_PAY)', () => {
  it('forma sem correspondência → erro, nunca omitida', () => {
    const r = buildSaleDocument(sale({ paymentType: 'CARD' }), maps, op);
    expect(r.body).toBeUndefined();
    expect(r.errors.join()).toMatch(/CARD/);
  });
  it('sem correspondência de Numerário não activa', () => {
    expect(companyReadiness(company({ engine: 'LPS', activatedAt: null, paymentMap: {} }), settings(), '5417000123', NOW).canActivate).toBe(false);
  });
});
