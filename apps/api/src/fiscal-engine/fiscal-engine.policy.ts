/**
 * Regras do MOTOR FISCAL — funções puras (sem base de dados), testadas à parte.
 *
 * Três motores (missão, fase 7):
 *   • VENDUS   — Modo A: o Cegid Vendus emite o documento fiscal; o LPS gere a venda.
 *   • LPS      — Modo B: motor próprio. Só se ACTIVA com validação própria documentada
 *                (nº, versão, evidência, testes, confirmação). As empresas que já o
 *                usavam antes deste módulo ficam marcadas "legado" (decisão do Super Admin).
 *   • SUSPENSO — Modo C: nenhum motor autorizado → não se emitem documentos fiscais.
 *
 * NUNCA há passagem automática de VENDUS para LPS quando o Vendus falha.
 */

export type EngineCode = 'LPS' | 'VENDUS' | 'SUSPENSO';

export type ValidityStatus = 'CONFIRMADO' | 'PENDENTE' | 'EXPIRADO';

/** Estados internos de um documento do motor externo (missão, fase 11). */
export const DOC_STATES = [
  'RASCUNHO',
  'A_PREPARAR',
  'A_ENVIAR',
  'CRIADO_NO_VENDUS',
  'COMUNICACAO_AGT_PENDENTE',
  'AGT_ACEITE',
  'AGT_REJEITADO',
  'ESTADO_DESCONHECIDO',
  'ERRO_DE_COMUNICACAO',
  'CORRECCAO_NECESSARIA',
] as const;
export type DocState = (typeof DOC_STATES)[number];

/** Indicadores de estado da ligação de uma empresa (missão, fase 4). */
export type CompanyIndicator =
  | 'NAO_CONFIGURADA'
  | 'CREDENCIAIS_POR_INSERIR'
  | 'LIGACAO_NAO_TESTADA'
  | 'CREDENCIAIS_INVALIDAS'
  | 'CONTA_DIFERENTE'
  | 'SUBSCRICAO_INACTIVA'
  | 'CAIXA_NAO_API'
  | 'SERVICO_INDISPONIVEL'
  | 'CONTA_IDENTIFICADA'
  | 'CONFIGURACAO_FISCAL_PENDENTE'
  | 'CERTIFICACAO_POR_CONFIRMAR'
  | 'VALIDADE_POR_CONFIRMAR'
  | 'TESTES_PENDENTES'
  | 'PRONTO_PARA_ACTIVACAO'
  | 'MOTOR_ACTIVO'
  | 'INTEGRACAO_SUSPENSA';

export interface SettingsLike {
  vendusEnabled: boolean;
  providerProducer: string;
  providerSoftware: string;
  providerValidationNo: string;
  providerVersion: string;
  providerFeCertNo?: string;
  providerValidUntil: Date | null;
  providerEvidenceUrl: string;
  providerEvidenceId: string | null;
  providerVerifiedAt: Date | null;
  providerVerifiedBy: string;
  alertDays: number[];
  alertsSent: unknown;
  lpsValidationNo: string;
  lpsValidationVersion: string;
  lpsEvidenceId: string | null;
  lpsTestsApprovedAt: Date | null;
  lpsConfirmedAt: Date | null;
  lpsConfirmedBy: string;
}

export interface CompanyLike {
  engine: string;
  suspendedReason: string;
  apiKeyEnc: string | null;
  apiKeySetAt: Date | null;
  accountId: string;
  accountFiscalId: string;
  accountCountry: string;
  registerId: string;
  registerSubscription: string;
  registerType?: string;
  paymentMap?: unknown;
  feConfirmedAt: Date | null;
  lastTestAt: Date | null;
  lastTestOk: boolean;
  lastTestCode: string;
  testsPassedAt: Date | null;
  activatedAt: Date | null;
}

const DAY = 86_400_000;

/** "Hoje" em Luanda (UTC+1) como data YYYY-MM-DD. */
export function luandaToday(now = new Date()): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

function ymd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Dias até à data de validade (0 = vence hoje; negativo = expirado). */
export function daysUntil(until: Date | null, now = new Date()): number | null {
  const u = ymd(until);
  if (!u) return null;
  return Math.round((Date.parse(`${u}T00:00:00Z`) - Date.parse(`${luandaToday(now)}T00:00:00Z`)) / DAY);
}

/**
 * Validade da validação AGT do fornecedor. CONFIRMADO só com TODOS os dados
 * oficiais (produtor, software, nº, versão, validade), uma evidência (documento
 * carregado ou URL oficial), quem verificou e quando. A data nunca se assume.
 * Depois do dia de vencimento → EXPIRADO, até chegar nova evidência com nova data.
 */
export function providerValidity(s: SettingsLike, now = new Date()): { status: ValidityStatus; daysLeft: number | null; missing: string[] } {
  const missing: string[] = [];
  if (!s.providerProducer.trim()) missing.push('produtor');
  if (!s.providerSoftware.trim()) missing.push('software');
  if (!s.providerValidationNo.trim()) missing.push('número de validação');
  if (!s.providerVersion.trim()) missing.push('versão');
  if (!s.providerValidUntil) missing.push('data de validade');
  if (!s.providerEvidenceId && !/^https:\/\//.test(s.providerEvidenceUrl.trim())) missing.push('evidência');
  if (!s.providerVerifiedAt) missing.push('data da verificação');
  if (!s.providerVerifiedBy.trim()) missing.push('responsável pela verificação');
  const daysLeft = daysUntil(s.providerValidUntil, now);
  if (daysLeft !== null && daysLeft < 0) return { status: 'EXPIRADO', daysLeft, missing };
  return { status: missing.length ? 'PENDENTE' : 'CONFIRMADO', daysLeft, missing };
}

/** Alertas de vencimento já devidos e ainda não registados (30/15/7/0 dias, configuráveis). */
export function dueAlerts(s: SettingsLike, now = new Date()): { key: string; days: number }[] {
  const left = daysUntil(s.providerValidUntil, now);
  const until = ymd(s.providerValidUntil);
  if (left === null || !until) return [];
  const sent = (s.alertsSent ?? {}) as Record<string, string>;
  const thresholds = [...new Set(s.alertDays)].filter((d) => Number.isInteger(d) && d >= 0).sort((a, b) => a - b);
  // Só o limiar mais próximo já atingido (não dispara 30, 15 e 7 de uma vez).
  const reached = thresholds.filter((d) => left <= d);
  if (!reached.length) return [];
  const d = reached[0];
  const key = `${until}:${d}`;
  return sent[key] ? [] : [{ key, days: d }];
}

/** Validação própria do LPS completa (Modo B). */
export function lpsValidationComplete(s: SettingsLike): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!s.lpsValidationNo.trim()) missing.push('número de validação próprio');
  if (!s.lpsValidationVersion.trim()) missing.push('versão autorizada');
  if (!s.lpsEvidenceId) missing.push('evidência documental');
  if (!s.lpsTestsApprovedAt) missing.push('testes aprovados');
  if (!s.lpsConfirmedAt || !s.lpsConfirmedBy.trim()) missing.push('confirmação do Super Admin');
  return { ok: missing.length === 0, missing };
}

export interface Readiness {
  indicator: CompanyIndicator;
  checks: { key: string; ok: boolean }[];
  canActivate: boolean;
}

/**
 * Indicador da ligação Vendus de uma empresa + lista de verificações.
 * A activação exige TODAS: chave, ligação testada, conta do mesmo NIF e de Angola,
 * caixa identificada com subscrição activa, FE configurada no Vendus (confirmada),
 * validade do fornecedor CONFIRMADA, testes concluídos e o switch global ligado.
 */
export function companyReadiness(c: CompanyLike | null, s: SettingsLike, companyNif: string, now = new Date()): Readiness {
  const validity = providerValidity(s, now);
  const nifOk = !!c && sameNif(c.accountFiscalId, companyNif);
  const testedAfterKey = !!c?.lastTestAt && (!c.apiKeySetAt || c.lastTestAt >= c.apiKeySetAt);
  const checks = [
    { key: 'chave', ok: !!c?.apiKeyEnc },
    { key: 'ligacao', ok: !!c && testedAfterKey && c.lastTestOk },
    { key: 'conta', ok: !!c?.accountFiscalId && nifOk },
    { key: 'pais', ok: isAngola(c?.accountCountry ?? '') },
    { key: 'caixa', ok: !!c?.registerId && isYes(c.registerSubscription) && (c.registerType ?? 'api').toLowerCase() === 'api' },
    { key: 'pagamentos', ok: !!(c?.paymentMap as Record<string, string> | undefined)?.CASH },
    { key: 'fe_vendus', ok: !!c?.feConfirmedAt },
    { key: 'validade', ok: validity.status === 'CONFIRMADO' },
    { key: 'testes', ok: !!c?.testsPassedAt && (!c.apiKeySetAt || c.testsPassedAt >= c.apiKeySetAt) },
    { key: 'switch', ok: s.vendusEnabled },
  ];
  const canActivate = checks.every((x) => x.ok);
  let indicator: CompanyIndicator;
  if (!c) indicator = 'NAO_CONFIGURADA';
  else if (c.engine === 'VENDUS' && c.activatedAt && canActivate) indicator = 'MOTOR_ACTIVO';
  else if (c.engine === 'SUSPENSO' || (c.engine === 'VENDUS' && c.activatedAt && !canActivate)) indicator = 'INTEGRACAO_SUSPENSA';
  else if (!c.apiKeyEnc) indicator = 'CREDENCIAIS_POR_INSERIR';
  else if (!testedAfterKey) indicator = 'LIGACAO_NAO_TESTADA';
  else if (c.lastTestCode === 'CHAVE_INVALIDA') indicator = 'CREDENCIAIS_INVALIDAS';
  else if (['NIF_DIFERENTE', 'PAIS_DIFERENTE', 'CONTA_SEM_NIF'].includes(c.lastTestCode)) indicator = 'CONTA_DIFERENTE';
  else if (c.lastTestCode === 'SUBSCRICAO_INACTIVA' || (c.registerId && !isYes(c.registerSubscription))) indicator = 'SUBSCRICAO_INACTIVA';
  else if (c.lastTestCode === 'CAIXA_NAO_API') indicator = 'CAIXA_NAO_API';
  else if (['INDISPONIVEL', 'TIMEOUT', 'REDE', 'LIMITE'].includes(c.lastTestCode)) indicator = 'SERVICO_INDISPONIVEL';
  else if (!c.lastTestOk || !nifOk) indicator = 'LIGACAO_NAO_TESTADA';
  else if (!c.registerId || !c.feConfirmedAt) indicator = c.feConfirmedAt ? 'CONTA_IDENTIFICADA' : 'CONFIGURACAO_FISCAL_PENDENTE';
  else if (validity.status === 'EXPIRADO') indicator = 'VALIDADE_POR_CONFIRMAR';
  else if (validity.status !== 'CONFIRMADO') indicator = 'CERTIFICACAO_POR_CONFIRMAR';
  else if (!checks.find((x) => x.key === 'testes')!.ok) indicator = 'TESTES_PENDENTES';
  else indicator = 'PRONTO_PARA_ACTIVACAO';
  return { indicator, checks, canActivate };
}

/**
 * Motor EFECTIVO de uma empresa no momento da emissão. É calculado a partir dos
 * dados (não de um booleano), por isso voltar a ligar o switch não contorna uma
 * validade expirada: só nova evidência de renovação repõe o estado operacional.
 */
export function effectiveEngine(c: CompanyLike | null, s: SettingsLike, companyNif: string, now = new Date()): { engine: EngineCode; reason: string; legacy: boolean } {
  if (!c || c.engine === 'LPS') {
    const lps = lpsValidationComplete(s);
    return { engine: 'LPS', reason: lps.ok ? '' : 'Motor próprio sem validação AGT documentada', legacy: !lps.ok };
  }
  if (c.engine === 'SUSPENSO') return { engine: 'SUSPENSO', reason: c.suspendedReason || 'Emissão fiscal suspensa pelo Super Admin', legacy: false };
  // VENDUS
  if (!c.activatedAt) return { engine: 'SUSPENSO', reason: 'Motor Vendus ainda não activado', legacy: false };
  const v = providerValidity(s, now);
  if (v.status === 'EXPIRADO') return { engine: 'SUSPENSO', reason: 'Validação AGT do Cegid Vendus expirada — falta evidência de renovação', legacy: false };
  if (v.status !== 'CONFIRMADO') return { engine: 'SUSPENSO', reason: 'Validade da validação AGT do Cegid Vendus por confirmar', legacy: false };
  if (!s.vendusEnabled) return { engine: 'SUSPENSO', reason: 'Motor fiscal externo desligado no Super Admin', legacy: false };
  const r = companyReadiness(c, s, companyNif, now);
  if (!r.canActivate) {
    const failed = r.checks.filter((x) => !x.ok).map((x) => x.key).join(', ');
    return { engine: 'SUSPENSO', reason: `Ligação Vendus incompleta (${failed})`, legacy: false };
  }
  return { engine: 'VENDUS', reason: '', legacy: false };
}

export function normNif(v: string | null | undefined): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isYes(v: unknown): boolean {
  return v === true || v === 1 || ['yes', 'y', 'sim', '1', 'true', 'active', 'on'].includes(String(v ?? '').trim().toLowerCase());
}

/**
 * Estado AGT de um documento a partir do detalhe devolvido pelo Vendus.
 *
 * A API v1.1/v1.2 só devolve `agt: { document_number, qrcode_image }` — não há
 * campo de aceitação/rejeição. Por isso NUNCA se conclui AGT_ACEITE nem
 * AGT_REJEITADO a partir de HTTP 200/201, de PDF, hash ou QR Code: o documento
 * fica em COMUNICACAO_AGT_PENDENTE (a consulta oficial é no Backoffice Vendus:
 * Gestão → Factura Electrónica → documentos rejeitados).
 */
export function agtStateFromDetails(details: Record<string, any> | null | undefined, mode: string): DocState {
  if (!details || !details.id) return 'ESTADO_DESCONHECIDO';
  if (mode === 'tests') return 'CRIADO_NO_VENDUS'; // Formação/Testes: sem validade fiscal, não é comunicado
  return 'COMUNICACAO_AGT_PENDENTE';
}

/** Próxima tentativa (backoff exponencial, máx. 30 min). */
export function nextAttemptDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Conta lida de GET /account/ — tolerante à forma real (objecto, lista ou envelope). */
export interface VendusAccountInfo {
  id: string;
  company: string;
  fiscalId: string;
  country: string;
  address: string;
  /** Nomes dos campos recebidos (diagnóstico; nunca os valores). */
  keys: string[];
}

function unwrap(data: unknown): Record<string, any> {
  let d: any = data;
  for (let i = 0; i < 3; i++) {
    if (Array.isArray(d)) d = d[0];
    else if (d && typeof d === 'object' && !('id' in d) && (d.account || d.data || d.response)) d = d.account ?? d.data ?? d.response;
    else break;
  }
  return d && typeof d === 'object' ? (d as Record<string, any>) : {};
}

const first = (o: Record<string, any>, keys: string[]): string => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

export function readVendusAccount(data: unknown): VendusAccountInfo {
  const a = unwrap(data);
  // Atenção: na especificação `tax_id` da conta é a TAXA de imposto por omissão, não o NIF.
  return {
    id: first(a, ['id', 'account_id']),
    company: first(a, ['company', 'company_name', 'name', 'title']),
    fiscalId: first(a, ['fiscal_id', 'fiscalId', 'nif', 'vat', 'vat_number', 'tax_number', 'tax_registration_number']),
    country: first(a, ['country', 'country_code', 'country_id', 'country_iso']),
    address: [first(a, ['address']), first(a, ['postal_code', 'postalcode']), first(a, ['city'])].filter(Boolean).join(', '),
    keys: Object.keys(a).slice(0, 40),
  };
}

/** País de Angola em qualquer das formas habituais ("AO", "AGO", "Angola", "AO - Angola"). */
export function isAngola(country: string): boolean {
  const c = String(country ?? '').trim().toUpperCase();
  return c === 'AO' || c === 'AGO' || /\bANGOLA\b/.test(c) || /^AO\b/.test(c);
}

/** NIFs iguais (ignora espaços, pontuação e o prefixo de país "AO"). */
export function sameNif(a: string, b: string): boolean {
  const n = (v: string) => normNif(v).replace(/^AO(?=\d)/, '');
  const x = n(a);
  return x !== '' && x === n(b);
}

/** Subscrição de uma caixa (detalhe de GET /registers/{id}/). */
export function registerSubscriptionActive(r: Record<string, any>): { active: boolean; raw: string } {
  const raw = first(r, ['subscription_active', 'subscription', 'subscription_status', 'active']);
  if (isYes(raw)) return { active: true, raw };
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return { active: Date.parse(raw.slice(0, 10)) >= Date.parse(new Date().toISOString().slice(0, 10)), raw };
  return { active: false, raw };
}

/** Plano, fim da subscrição e subdomínio da conta Vendus (campos opcionais: a
 *  especificação não os documenta, lêem-se quando a conta os devolve). */
export function readVendusPlan(data: unknown): { plan: string; expires: string; subdomain: string } {
  const a = unwrap(data);
  const sub = (a.subscription && typeof a.subscription === 'object' ? a.subscription : {}) as Record<string, any>;
  const url = first(a, ['url', 'account_url', 'backoffice_url', 'domain', 'subdomain', 'slug']);
  const m = url.match(/^(?:https?:\/\/)?([a-z0-9-]+)(?:\.vendus\.[a-z.]+)?/i);
  return {
    plan: first(a, ['plan', 'plan_name', 'subscription_plan']) || first(sub, ['plan', 'name', 'title']),
    expires: first(a, ['subscription_expires', 'subscription_end', 'plan_expires', 'expiration_date', 'valid_until'])
      || first(sub, ['expires', 'end', 'date_end', 'valid_until']),
    subdomain: m && m[1] && !/^www$/i.test(m[1]) ? m[1].toLowerCase() : '',
  };
}

/**
 * Período da subscrição Vendus a partir da data de fim, contado COMO NO
 * BACKOFFICE VENDUS (ex.: fim 21/12, hoje 24/11 → "Faltam 27 dias", 13%):
 * período mensal (ou anual se o fim estiver a mais de 40 dias), dias que
 * faltam arredondados para cima, o dia de hoje já conta como gasto e a
 * percentagem é arredondada PARA BAIXO (fim 21/12, hoje 25/11 → 5/30 = 16%).
 */
export function vendusSubscriptionPeriod(expires: string, now = new Date()): {
  active: boolean; pct: number; leftPct: number; totalDays: number; usedDays: number; daysLeft: number; expiresAt: string | null;
} | null {
  const t = String(expires ?? '').trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const pt = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!iso && !pt) return null;
  const [y, mo, d] = iso ? [+iso[1], +iso[2], +iso[3]] : [+pt![3], +pt![2], +pt![1]];
  // Fim à meia-noite de Luanda (UTC+1).
  const end = Date.UTC(y, mo - 1, d) - 3600_000;
  if (!Number.isFinite(end)) return null;
  const annual = end - now.getTime() > 40 * 864e5;
  const start = Date.UTC(annual ? y - 1 : y, annual ? mo - 1 : mo - 2, d) - 3600_000;
  const totalDays = Math.max(1, Math.round((end - start) / 864e5));
  if (end <= now.getTime()) return { active: false, pct: 100, leftPct: 0, totalDays, usedDays: totalDays, daysLeft: 0, expiresAt: new Date(end).toISOString() };
  const daysLeft = Math.min(totalDays, Math.max(0, Math.ceil((end - now.getTime()) / 864e5)));
  const usedDays = Math.min(totalDays, totalDays - daysLeft + 1);
  const pct = Math.round((usedDays / totalDays) * 100);
  return { active: true, pct, leftPct: 100 - pct, totalDays, usedDays, daysLeft, expiresAt: new Date(end).toISOString() };
}

/**
 * NÚMERO AGT do documento (o que a AGT atribui, ex.: "FR4026S94851N/4"), lido do
 * bloco `agt` do detalhe Vendus. É ESTE o número que o cliente e o caixa vêem
 * (o "02P2026/6" é só a numeração interna do Vendus). Vazio enquanto a AGT não
 * o atribuir.
 */
export function agtDocumentNumber(agt: unknown): string | null {
  if (!agt || typeof agt !== 'object') return null;
  const a = agt as Record<string, unknown>;
  const v = a.document_number ?? a.documentNumber ?? a.number;
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s && /[A-Za-z]/.test(s) ? s : null;
}
