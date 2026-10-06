import { API_URL, isNativeApp } from '../config';
import { mirrorStaffWrite, mirrorsToCloud } from '../offline/cloudMirror';
import { usingLocalServer } from '../offline/localServer';
import { canQueue, enqueueWrite, newOpId, replayOutbox, withSnake, type OutboxOp, type SendResult } from '../offline/outbox';
import { anotarFalhaDaLoja, anotarSucessoDaLoja, baseParaPedido } from '../offline/shopLink';
import { sharedGet, sharedSet } from '../sharedCache';
import { applyToCatalog, queryCatalog } from '../offline/catalog';
import { customersStore } from '../offline/indexedList';
import type {
  AgtCommResult,
  AgtCommStatus,
  AgtConfig,
  AiProvider,
  AppReleaseRow,
  AppReleaseInput,
  PublicRelease,
  BackupMeta,
  BackupSettings,
  MigrationApplyResult,
  MigrationKind,
  MigrationPreview,
  RestorePreview,
  RestoreResult,
  AssistantConfig,
  BankAccount,
  Company,
  CompanyStatus,
  CreateExpenseInput,
  CreateGatewayInput,
  CreateProductInput,
  CreateProviderInput,
  DashLowStock,
  DashStoreSales,
  DashSalesSeries,
  DashSalesSummary,
  DashTopProduct,
  CashflowForecast,
  CashflowPoint,
  CashflowSummary,
  CommissionReport,
  BankTx,
  ReconSummary,
  ImportStatementRow,
  LeaveRow,
  LeaveEmployee,
  LeaveSummary,
  CreateLeaveInput,
  ManagerEmployee,
  EmployeeConsumption,
  CreateEmployeeInput,
  UpdateEmployeeInput,
  ManagerStore,
  ManagerStaff,
  CreateStoreInput,
  UpdateStoreInput,
  CreateStaffInput,
  UpdateStaffInput,
  CreatedStaff,
  Expense,
  ExpenseSummary,
  PaymentReceipt,
  Receivable,
  ReceivableDetail,
  ReceivableSummary,
  CreateReceivableInput,
  RecordPaymentInput,
  Payable,
  PayableDetail,
  PayableSummary,
  PayableVoucher,
  CreatePayableInput,
  RecordPayablePaymentInput,
  Gateway,
  Integration,
  UpdateIntegrationInput,
  LandingConfig,
  MailConfigInput,
  MailConfigView,
  AuditEvent,
  CashSessionRow,
  ManagerProduct,
  OpsAlert,
  ProfitAbcRow,
  ProfitPoint,
  ProfitProduct,
  ProfitSummary,
  ReportUserRow,
  ReportCategoryRow,
  ReportTaxRow,
  ReportPaymentRow,
  ReportDocRow,
  ReportCashSession,
  Promotion,
  PromotionInput,
  PaymentMethodInput,
  PaymentProof,
  StockCountDetail,
  StockCountRow,
  StockMovementRow,
  StockAnalysis,
  StockEntryInput,
  AbcReport,
  ReplenishmentReport,
  ValuationReport,
  FraudReport,
  LocationRow,
  TransferRequestRow,
  AuditTrailRow,
  AuditFilters,
  BatchInput,
  ExpiringBatch,
  StorePaymentMethod,
  WarehouseRow,
  OrderMessage,
  SupplierRow,
  CreateSupplierInput,
  PurchaseOrderRow,
  CreatePurchaseOrderInput,
  PayrollRun,
  PayrollRunDetail,
  AssistantMessage,
  AssistantGreeting,
  AssistantChatReply,
  AssistantTts,
  AssistantVoiceTurn,
  AssistantCallSession,
  SubMessage,
  Subscription,
  PlatformKpis,
  PlatformSeriesPoint,
  RecentCompany,
  PlatformLoginInput,
  PublicLanding,
  PublicPlan,
  VerticalMetrics,
  DocumentIdentity,
  SaleDetail,
  RegisterCompanyInput,
  RegisterCompanyResult,
  SiteSettings,
  AgentEvent,
  CameraInput,
  CameraRow,
  PublicWebcamsResult,
  CustomerRow,
  TenantLoginInput,
  TenantTokenPair,
  TokenPair,
  UpdateAgtInput,
  UpdateProductInput,
  UpdateSiteSettingsInput,
  RestaurantSalesReport,
  WebOrder,
  WebOrderDetail,
  OrderLocation,
  SalaryAdvanceReq,
  SupportMsg,
  SiteFeedback,
  SiteFeedbackAdmin,
  AdminChat,
  FeedbackStats,
} from './types';

/** IVA dos produtos importados (migração). */
export interface MigrationTax { ivaCode: 'NOR' | 'INT' | 'RED' | 'ISE' | 'OUT'; exemptionCode?: string; pricesIncludeIva: boolean }

/** Constrói uma query string a partir de pares definidos (?from=…&to=…). */
function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const k in params) { const v = params[k]; if (v) p.set(k, v); }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Corpo completo do erro (ex.: ChooseCompany traz a lista de empresas). */
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthHooks {
  getAccessToken(): string | null;
  /** Código da empresa (X-Tenant-Code) — só no modo gestor. */
  getCompanyCode?(): string | undefined;
  refresh(): Promise<boolean>;
  onAuthLost(): void;
}
let hooks: AuthHooks | null = null;
export function configureApi(h: AuthHooks): void {
  hooks = h;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Erro ${res.status}`;
  let data: unknown;
  try {
    const j = (await res.json()) as { message?: string | string[] };
    data = j;
    if (Array.isArray(j.message)) message = j.message.join('; ');
    else if (j.message) message = j.message;
  } catch {
    /* sem corpo */
  }
  return new ApiError(res.status, message, data);
}

/**
 * MEMÓRIA INTERNA PRIMEIRO (apps instaladas).
 *
 * Quando o aparelho já sabe que não há servidor (a última tentativa falhou por
 * rede), as LEITURAS respondem logo da memória interna — sem esperar por um
 * pedido que vai falhar — e as ESCRITAS vão direto para a fila. Em segundo plano,
 * de 15 em 15 s, sonda o servidor; mal responda, tudo volta a ir à rede, as
 * alterações guardadas sobem e a memória atualiza-se. O utilizador não vê nada.
 */
let semRede = false;
let ultimaSonda = 0;
function marcarSemRede(): void { semRede = true; }
function marcarComRede(): void {
  if (semRede && typeof window !== 'undefined') window.dispatchEvent(new Event('online'));
  semRede = false;
}
function sondarServidor(): void {
  if (Date.now() - ultimaSonda < 15_000) return;
  ultimaSonda = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  fetch(`${baseParaPedido(API_URL)}/health`, { signal: ctrl.signal })
    .then((r) => { if (r.ok) marcarComRede(); })
    .catch(() => undefined)
    .finally(() => clearTimeout(t));
}
/** Caminho sem query: chave de recurso para quando a página pede outro filtro/data sem rede. */
const semQuery = (path: string) => path.split('?')[0];
/** Produtos: listas/páginas/pesquisas respondidas pela base indexada (offline/catalog). */
const PRODUTOS = /^\/pos\/products(\/all)?(\?|$)/;
/**
 * Leituras que NUNCA vêm da memória:
 *  • `/…/changes` — alterações incrementais: uma página antiga servida de novo
 *    sobrepunha edições feitas offline e, com o cursor a meio, ficava em ciclo;
 *  • `/auth/…` — o pacote de credenciais offline: servido da cache, renovava a
 *    validade e um funcionário despedido continuava a entrar sem rede.
 */
const SEM_CACHE = /\/changes(\?|$)|^\/auth\//;

async function lerDaMemoria<T>(path: string): Promise<T | null> {
  if (SEM_CACHE.test(path)) return null;
  if (PRODUTOS.test(path)) {
    const company = hooks?.getCompanyCode?.();
    if (!company) return null;
    const u = new URL(path, 'http://x');
    const rows = await queryCatalog(company, {
      q: u.searchParams.get('q') ?? '',
      limit: Number(u.searchParams.get('limit')) || 1000,
      offset: Number(u.searchParams.get('offset')) || 0,
      includeInactive: u.pathname.endsWith('/all'),
    }).catch(() => []);
    return rows as unknown as T;
  }
  if (CLIENTES.test(path)) {
    const company = hooks?.getCompanyCode?.();
    if (company) {
      const u = new URL(path, 'http://x');
      const rows = await customersStore.query(company, {
        q: u.searchParams.get('q') ?? '', limit: Number(u.searchParams.get('limit')) || 500,
        offset: Number(u.searchParams.get('offset')) || 0,
      }).catch(() => []);
      if (rows.length || u.searchParams.get('q')) return rows as unknown as T;
    }
  }
  return (await sharedGet<T>(`GET ${path}`)) ?? (await sharedGet<T>(`GET ${semQuery(path)}`));
}
/** Clientes: base indexada própria (offline/indexedList) — empresas com muitos clientes. */
const CLIENTES = /^\/pos\/customers(\?|$)/;

/** Escrita guardada na fila do aparelho; produtos refletem-se já na memória do catálogo. */
async function guardarNaFila(method: string, path: string, body: unknown, opId: string): Promise<unknown> {
  const res = await enqueueWrite(method, path, body, opId);
  const m = /^\/pos\/products(?:\/([^/?]+))?(?:\?|$)/.exec(path);
  const company = hooks?.getCompanyCode?.();
  if (m && company && !['all', 'changes', 'ingredients'].includes(m[1] ?? '')) {
    const b = withSnake((body && typeof body === 'object' ? body : {}) as Record<string, unknown>);
    const M = method.toUpperCase();
    if (M === 'POST' && !m[1]) await applyToCatalog(company, 'create', String((res as { id?: string }).id), b).catch(() => undefined);
    else if (M === 'DELETE' && m[1]) await applyToCatalog(company, 'delete', m[1]).catch(() => undefined);
    else if (m[1]) await applyToCatalog(company, 'update', m[1], b).catch(() => undefined);
  }
  const c = /^\/pos\/customers(?:\/([^/?]+))?(?:\?|$)/.exec(path);
  if (c && company && c[1] !== 'changes') {
    const b = withSnake((body && typeof body === 'object' ? body : {}) as Record<string, unknown>);
    const M = method.toUpperCase();
    if (M === 'POST' && !c[1]) await customersStore.apply(company, 'create', String((res as { id?: string }).id), b).catch(() => undefined);
    else if (M === 'DELETE' && c[1]) await customersStore.apply(company, 'delete', c[1]).catch(() => undefined);
    else if (c[1]) await customersStore.apply(company, 'update', c[1], b).catch(() => undefined);
  }
  return res;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { auth?: boolean; retry?: boolean; timeoutMs?: number; queue?: boolean } = {},
): Promise<T> {
  const { auth = true, retry = true, timeoutMs = 90_000 } = opts;
  // OFFLINE-FIRST (read-through cache): as LEITURAS (GET) são guardadas na cache
  // partilhada e, quando não há rede, servidas de lá — a Gestão fica navegável
  // sem internet (e no Android partilha os dados com a Caixa, mesma origem). É
  // ADITIVO: online devolve sempre dados frescos; escrita/POST não têm cache.
  const isGet = method.toUpperCase() === 'GET';
  const cacheKey = `GET ${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = hooks?.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const code = hooks?.getCompanyCode?.();
    if (code) headers['X-Tenant-Code'] = code;
  }
  // ESCRITA em apps instaladas: UUID de idempotência desde a 1.ª tentativa. Se a resposta se perder,
  // o reenvio (da fila) leva o MESMO id e o servidor devolve a resposta guardada — sem duplicar.
  const queueable = isNativeApp() && !isGet && opts.queue !== false && canQueue(method, path);
  const opId = queueable ? newOpId() : undefined;
  if (opId) headers['X-Client-Op-Id'] = opId;
  if (isNativeApp() && semRede) {
    sondarServidor();
    if (isGet) {
      const mem = await lerDaMemoria<T>(path);
      if (mem != null) return mem;
    } else if (queueable && opId) {
      return (await guardarNaFila(method, path, body, opId)) as T;
    }
  }
  // NOTA: NÃO usamos `navigator.onLine` para decidir se há rede. Nas apps nativas
  // ele MENTE — no Electron (protocolo ndombaxi://) e no WebView do Android reporta
  // `false` mesmo com internet, o que bloqueava todos os pedidos ("sem ligação").
  // A deteção fiável é: tentar o fetch e, se falhar, servir a cache (catch abaixo).

  let res: Response;
  // Timeout defensivo: sem ele, um servidor "a acordar" (cold start) deixava o
  // pedido pendurado para sempre (spinner infinito). 90 s cobre o arranque.
  const ctrl = new AbortController();
  // App: uma LEITURA não espera 90 s por uma rede fraca — ao fim de 12 s responde a memória.
  // E uma ESCRITA que pode ir para a fila não prende o utilizador mais de 8 s: com
  // rede fraca (ou as ligações ocupadas por descargas em 2.º plano) fica guardada
  // e sobe depois — sem risco, cada uma leva o seu X-Client-Op-Id (nunca em dobro).
  const limite = isNativeApp() && opts.timeoutMs === undefined && (isGet || queueable)
    ? (isGet ? 12_000 : 8_000) : timeoutMs;
  const timer = setTimeout(() => ctrl.abort(), limite);
  try {
    // SERVIDOR DA LOJA primeiro, se houver um configurado e a responder. É o
    // que dá ao telemóvel o sistema INTEIRO sem internet: compras, stock, RH e
    // o resto passam a ser respondidos pela mesma API, a correr no balcão. Sem
    // loja configurada — ou com ela em silêncio — isto é a nuvem de sempre.
    // No NAVEGADOR o sistema é 100% online: sem servidor da loja, sem cache offline.
    const base = isNativeApp() ? baseParaPedido(API_URL) : API_URL;
    const eraDaLoja = base !== API_URL;
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (eraDaLoja) anotarSucessoDaLoja();
    if (isNativeApp()) marcarComRede();
  } catch (e) {
    if (isNativeApp()) marcarSemRede();
    // Silêncio do servidor da loja: ao fim de algumas falhas seguidas o
    // aparelho volta à nuvem sozinho, em vez de ficar preso a um computador
    // que já não alcança.
    if (isNativeApp() && baseParaPedido(API_URL) !== API_URL) anotarFalhaDaLoja();
    // Sem rede: numa LEITURA, serve a última cópia guardada (não bloqueia o
    // trabalho offline). Um timeout (servidor a acordar) NÃO usa cache — é online.
    // SEM REDE numa ESCRITA: guarda na fila do aparelho e responde como se tivesse gravado.
    if (queueable && opId) {
      return (await guardarNaFila(method, path, body, opId)) as T;
    }
    if (isNativeApp() && isGet) {
      // Também num tempo esgotado: na app, a memória interna é a resposta.
      const cached = await lerDaMemoria<T>(path);
      if (cached != null) return cached;
    }
    throw new ApiError(0, (e as Error)?.name === 'AbortError'
      ? 'O servidor demorou demasiado a responder. Tente novamente.'
      : 'Sem ligação ao servidor.');
  } finally { clearTimeout(timer); }
  if (res.status === 401 && auth && retry && hooks) {
    const ok = await hooks.refresh();
    if (ok) return request<T>(method, path, body, { auth, retry: false, timeoutMs });
    // O refresh termina a sessão só se o token for REJEITADO; falha de rede
    // preserva a sessão (sem logout). Devolve o erro à UI.
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) {
    if (!isGet && mirrorsToCloud(method, path) && usingLocalServer()) void mirrorStaffWrite(method, path, body, undefined);
    return undefined as T;
  }
  const text = await res.text();
  const data = (text ? JSON.parse(text) : undefined) as T;
  // Funcionário alterado no SERVIDOR LOCAL: segue também para a nuvem pela API.
  if (!isGet && mirrorsToCloud(method, path) && usingLocalServer()) void mirrorStaffWrite(method, path, body, data);
  if (isNativeApp() && isGet && data !== undefined && !PRODUTOS.test(path) && !SEM_CACHE.test(path)) {
    // (Produtos ficam na base indexada própria — nunca como um bloco gigante aqui.)
    // Memória interna: a resposta exata e, à parte, a última versão do recurso
    // (sem filtros) — serve a mesma página sem rede com outro período/filtro.
    void sharedSet(cacheKey, data);
    if (semQuery(path) !== path) void sharedSet(`GET ${semQuery(path)}`, data);
  }
  return data;
}

/** Envia UMA operação da fila offline (com o seu UUID de idempotência). */
async function sendQueuedWrite(op: OutboxOp, refreshed = false): Promise<SendResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Client-Op-Id': op.id };
  const token = hooks?.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const code = hooks?.getCompanyCode?.();
  if (code) headers['X-Tenant-Code'] = code;
  let res: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    res = await fetch(`${baseParaPedido(API_URL)}${op.path}`, { method: op.method, headers, body: op.body === undefined ? undefined : JSON.stringify(op.body), signal: ctrl.signal });
    clearTimeout(t);
  } catch { return { ok: false, status: 0, message: 'Sem ligação ao servidor.', retry: true }; }
  if (res.status === 401 && hooks && !refreshed) {
    if (await hooks.refresh()) return sendQueuedWrite(op, true);
    return { ok: false, status: 401, message: 'Sessão expirada.', retry: true };
  }
  if (res.ok) {
    const text = res.status === 204 ? '' : await res.text().catch(() => '');
    let data: unknown; try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    // Produto criado sem rede já subiu: troca o registo provisório pelo do servidor.
    const company = hooks?.getCompanyCode?.();
    if (company && op.localId && /^\/pos\/products(\?|$)/.test(op.path)) {
      await applyToCatalog(company, 'delete', op.localId).catch(() => undefined);
      if (data && typeof data === 'object' && (data as { id?: string }).id) {
        await applyToCatalog(company, 'create', String((data as { id: string }).id), data as Record<string, unknown>).catch(() => undefined);
      }
    }
    return { ok: true, data };
  }
  const err = await parseError(res);
  return { ok: false, status: res.status, message: err.message, retry: res.status >= 500 || res.status === 429 || res.status === 408 || res.status === 401 };
}

export interface CatalogQuery { q?: string; limit?: number; offset?: number }
function catalogQs(o: CatalogQuery): string {
  const p = new URLSearchParams();
  if (o.q) p.set('q', o.q);
  p.set('limit', String(o.limit ?? 200));
  if (o.offset) p.set('offset', String(o.offset));
  return `?${p.toString()}`;
}

/** Leitura crua (usada pelo pré-carregamento para guardar TODAS as áreas na memória interna). */
export function prefetchGet(path: string): Promise<unknown> {
  return request<unknown>('GET', path, undefined, { timeoutMs: 60_000 });
}

/** Reenvia as alterações feitas offline (chamado em segundo plano; devolve quantas subiram). */
export function replayQueuedWrites(): Promise<number> {
  return replayOutbox((op) => sendQueuedWrite(op));
}

/** Como request, mas devolve o corpo em texto cru (ex.: XML do SAF-T). */
async function requestText(path: string, retry = true): Promise<string> {
  const headers: Record<string, string> = {};
  const token = hooks?.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const code = hooks?.getCompanyCode?.();
  if (code) headers['X-Tenant-Code'] = code;
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try { res = await fetch(`${API_URL}${path}`, { headers, signal: ctrl.signal }); }
  catch (e) {
    throw new ApiError(0, (e as Error)?.name === 'AbortError'
      ? 'O servidor demorou demasiado a responder. Tente novamente.'
      : 'Sem ligação ao servidor.');
  } finally { clearTimeout(timer); }
  if (res.status === 401 && retry && hooks) {
    const ok = await hooks.refresh();
    if (ok) return requestText(path, false);
    // Sem logout por falha de rede — o refresh já terminou a sessão se rejeitado.
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  return res.text();
}

export interface StockCheckRow { id: string; code: string; name: string; isActive: boolean; shown: number; stores: number }
export interface StockCheckResult {
  checked: number;
  semSaldoPorLoja: { total: number; items: StockCheckRow[] };
  diferencas: { total: number; items: StockCheckRow[] };
}

export const api = {
  login: (input: PlatformLoginInput) =>
    request<TokenPair>('POST', '/auth/super-admin/login', input, { auth: false }),
  /** Login do gestor da empresa (tenant) — só e-mail + palavra-passe;
   *  a API resolve a empresa e devolve o código. */
  loginTenant: (input: TenantLoginInput) =>
    request<TenantTokenPair>('POST', '/auth/login', input, { auth: false }),
  /** Login do gestor com Google (ID token); a empresa vem do e-mail Google. */
  loginGoogle: (idToken: string, companyCode?: string) =>
    request<TenantTokenPair>('POST', '/auth/login/google', { companyCode, idToken }, { auth: false }),
  /** Esqueci a senha — envia link de recuperação por e-mail. */
  forgotPassword: (email: string, companyCode?: string) =>
    request<{ ok: boolean; emailConfigured: boolean }>('POST', '/auth/forgot-password', { email, kind: 'PASSWORD', companyCode }, { auth: false }),
  /** Define a nova senha a partir do token recebido por e-mail. */
  resetPassword: (token: string, secret: string) =>
    request<{ ok: boolean; kind: string }>('POST', '/auth/reset-password', { token, secret }, { auth: false }),

  // ── SAF-T (AGT): exporta o XML fiscal mensal ───────────────
  saft: {
    export: (year: number, month: number) => requestText(`/pos/saft?year=${year}&month=${month}`),
  },

  // ── Comunicação eletrónica à AGT (DP 71/25) — por empresa (gestor) ─────
  agtComm: {
    status: () => request<AgtCommStatus>('GET', '/fiscal/agt/status'),
    communicate: () => request<AgtCommResult>('POST', '/fiscal/agt/communicate'),
  },

  // ── Backup & Restauro (dados de gestão nunca se perdem) ────
  backup: {
    settings: () => request<BackupSettings>('GET', '/backup/settings'),
    updateSettings: (dto: { autoEnabled?: boolean; frequency?: string }) => request<BackupSettings>('PATCH', '/backup/settings', dto),
    run: () => request<BackupMeta>('POST', '/backup/run', undefined, { timeoutMs: 600_000 }),
    list: () => request<BackupMeta[]>('GET', '/backup'),
    download: (id: string) => request<{ content: string; fileName: string }>('GET', `/backup/${id}/download`),
    remove: (id: string) => request<void>('DELETE', `/backup/${id}`),
    previewRestore: (contentBase64: string, fileName?: string) =>
      request<RestorePreview>('POST', '/backup/restore/preview', { contentBase64, fileName }),
    /** `storeId`: loja de destino para stock cuja loja de origem já não existe; omisso/null = essas linhas ficam por conta do próprio restauro. */
    applyRestore: (contentBase64: string, fileName?: string, storeId?: string | null) =>
      request<RestoreResult>('POST', '/backup/restore/apply', { contentBase64, fileName, storeId }, { timeoutMs: 600_000 }),
  },

  // ── Migração de outros sistemas (Vendus, Primavera, Negócio, etc.) ──
  migration: {
    /** `mapping`: só produtos — escolha manual das colunas (campo → cabeçalho; '' = não usar). */
    preview: (kind: MigrationKind, contentBase64: string, fileName?: string, mapping?: Record<string, string> | null) =>
      request<MigrationPreview>('POST', '/migration/preview', { kind, contentBase64, fileName, ...(mapping ? { mapping } : {}) }, { timeoutMs: 300_000 }),
    /** `storeId`: só produtos — loja específica (stock por loja) ou omisso/null = todas as lojas (partilhado).
     *  Timeout longo: um ficheiro grande (milhares de linhas) demora minutos no servidor (lotes). */
    apply: (kind: MigrationKind, contentBase64: string, fileName?: string, storeId?: string | null, mapping?: Record<string, string> | null, tax?: MigrationTax | null) =>
      request<MigrationApplyResult>('POST', '/migration/apply', { kind, contentBase64, fileName, storeId, ...(mapping ? { mapping } : {}), ...(tax ?? {}) }, { timeoutMs: 600_000 }),
    /** Importação em segundo plano (barra de progresso real): devolve o id do trabalho. */
    applyAsync: (kind: MigrationKind, contentBase64: string, fileName?: string, storeId?: string | null, mapping?: Record<string, string> | null, tax?: MigrationTax | null) =>
      request<{ jobId: string }>('POST', '/migration/apply-async', { kind, contentBase64, fileName, storeId, ...(mapping ? { mapping } : {}), ...(tax ?? {}) }, { timeoutMs: 120_000 }),
    job: (id: string) =>
      request<{ id: string; total: number; processed: number; status: 'running' | 'done' | 'error'; result?: MigrationApplyResult; error?: string }>('GET', `/migration/jobs/${id}`),
  },

  // ── Preferências do utilizador (tema por perfil) ───────────
  preferences: {
    get: () => request<{ theme: string }>('GET', '/auth/me/preferences'),
    setTheme: (theme: string) =>
      request<{ theme: string }>('PATCH', '/auth/me/preferences', { theme }),
  },

  /** Credenciais offline da empresa (o que permite entrar sem rede — ver
   *  `offline/credentials.ts`). Sem cache de leitura: quem guarda é o cofre. */
  offlineCredentials: () =>
    request<import('../offline/credentials').CredentialBundle>('GET', '/auth/offline-credentials'),

  // Desbloqueio do ecrã de bloqueio do painel (re-verifica a palavra-passe do próprio).
  verifyPassword: (password: string) =>
    request<{ ok: boolean }>('POST', '/auth/verify-password', { password }),

  // ── AGENTE IA (ferramentas reais + eventos em tempo real) ──
  /**
   * Stream SSE do agente: emite cada passo (ferramenta), anexos e o texto
   * final em tempo real. Devolve uma função para cancelar.
   */
  agentStream: (
    messages: { role: 'user' | 'assistant'; content: string }[],
    onEvent: (e: AgentEvent) => void,
  ): { cancel(): void; done: Promise<void> } => {
    const ctrl = new AbortController();
    const done = (async () => {
      const call = () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = hooks?.getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        const code = hooks?.getCompanyCode?.();
        if (code) headers['X-Tenant-Code'] = code;
        return fetch(`${API_URL}/ai/agent/chat`, {
          method: 'POST', headers, body: JSON.stringify({ messages }), signal: ctrl.signal,
        });
      };
      let res = await call();
      // Sessão expirada a meio da conversa → renova o token e tenta outra vez
      // (igual ao request normal), em vez de mostrar "Authentication required".
      if (res.status === 401 && hooks) {
        const ok = await hooks.refresh();
        if (ok) res = await call();
        // Sem logout por falha de rede — o refresh termina a sessão só se rejeitado.
      }
      if (!res.ok || !res.body) throw await parseError(res);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try { onEvent(JSON.parse(line.slice(6)) as AgentEvent); } catch { /* evento malformado */ }
        }
      }
    })();
    return { cancel: () => ctrl.abort(), done };
  },

  // ── Landing pública (sem auth) ─────────────────────────────
  publicLanding: () => request<PublicLanding>('GET', '/public/landing', undefined, { auth: false }),

  // ── Downloads públicos (para a secção "Baixar Aplicativo") ──
  publicDownloads: () =>
    request<Record<'windows' | 'android' | 'ios', PublicRelease | null>>(
      'GET', '/downloads/public', undefined, { auth: false }),

  // ── Suporte (chat com o assistente do sistema) + comentários públicos ──
  support: {
    start: (name?: string) =>
      request<{ chatId: string; greeting: string }>('POST', '/public/support/chats', { name }, { auth: false }),
    send: (chatId: string, body: string, history?: { role: 'user' | 'assistant'; content: string }[]) =>
      request<{ reply: string; imageSvg: string | null; escalated: boolean }>('POST', `/public/support/chats/${chatId}/messages`, { body, history }, { auth: false }),
    messages: (chatId: string, after?: string) =>
      request<SupportMsg[]>('GET', `/public/support/chats/${chatId}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`, undefined, { auth: false }),
    feedbackList: () => request<SiteFeedback[]>('GET', '/public/support/feedback', undefined, { auth: false }),
    feedbackAdd: (name: string, body: string) =>
      request<{ id: string }>('POST', '/public/support/feedback', { name, body }, { auth: false }),
    feedbackVote: (id: string, dir: 'up' | 'down') =>
      request<{ likes: number; dislikes: number }>('POST', `/public/support/feedback/${id}/vote`, { dir }, { auth: false }),
    admin: {
      notifications: () => request<{ unreadChats: number; humanWaiting: number; newFeedback: number; pendingCompanies?: number; pendingSubs?: number }>('GET', '/super-admin/support/notifications'),
      chats: () => request<AdminChat[]>('GET', '/super-admin/support/chats'),
      messages: (chatId: string) => request<SupportMsg[]>('GET', `/super-admin/support/chats/${chatId}/messages`),
      reply: (chatId: string, body: string) => request<void>('POST', `/super-admin/support/chats/${chatId}/messages`, { body }),
      read: (chatId: string) => request<void>('POST', `/super-admin/support/chats/${chatId}/read`),
      close: (chatId: string) => request<void>('POST', `/super-admin/support/chats/${chatId}/close`),
      feedback: () => request<{ items: SiteFeedbackAdmin[]; stats: FeedbackStats }>('GET', '/super-admin/support/feedback'),
    },
  },
  registerCompany: (input: RegisterCompanyInput) =>
    request<RegisterCompanyResult>('POST', '/onboarding/register', input, { auth: false }),
  // Registo simples (email+senha OU Google) + setup obrigatório
  registerSimple: (input: { email?: string; password?: string; googleIdToken?: string; planTier: string; businessType?: string }) =>
    request<{ tokens: TokenPair; companyCode: string; setupCompleted: boolean }>('POST', '/onboarding/register-simple', input, { auth: false }),
  onboarding: {
    myPlan: () => request<{ planId: string; planName: string; priceKz: number; tier?: string } | null>('GET', '/onboarding/my-plan'),
    setupStatus: () => request<{ setupCompleted: boolean; status: string; approved: boolean; expired: boolean; expiresAt: string | null }>('GET', '/onboarding/setup-status'),
    completeSetup: (dto: { name: string; companyCode?: string; nif: string; logoUrl?: string }) =>
      request<{ ok: true; companyCode: string }>('POST', '/onboarding/complete-setup', dto),
  },

  // ── Subscrição na landing pós-registo (sem login, via setupToken) ──
  setup: {
    createSubscription: (setupToken: string, dto: { planId: string; method: 'IBAN' | 'REFERENCE'; bankAccountId?: string }) =>
      request<{ id: string; status: string }>('POST', '/onboarding/setup/subscription', { setupToken, ...dto }, { auth: false }),
    submitProof: (setupToken: string, id: string, dto: { fileName: string; fileType: string; fileData: string; amountKz?: number }) =>
      request<{ id: string }>('POST', `/onboarding/setup/subscription/${id}/proof`, { setupToken, ...dto }, { auth: false }),
  },

  // ── Dashboard global da plataforma (Super Admin) ───────────
  platformDashboard: {
    kpis: () => request<PlatformKpis>('GET', '/super-admin/dashboard/kpis'),
    series: (days = 14) => request<PlatformSeriesPoint[]>('GET', `/super-admin/dashboard/series?days=${days}`),
    recentCompanies: (limit = 8) =>
      request<RecentCompany[]>('GET', `/super-admin/dashboard/recent-companies?limit=${limit}`),
  },

  // ── E-mail (SMTP) — gestão pelo Super Admin ────────────────
  mailAdmin: {
    get: () => request<MailConfigView>('GET', '/super-admin/mail'),
    save: (dto: MailConfigInput) => request<MailConfigView>('PUT', '/super-admin/mail', dto),
    test: (to: string) => request<{ ok: boolean; message: string }>('POST', '/super-admin/mail/test', { to }),
  },

  // ── Gestão de Downloads das apps — Super Admin ─────────────
  downloadsAdmin: {
    list: () => request<AppReleaseRow[]>('GET', '/super-admin/downloads'),
    create: (dto: AppReleaseInput) => request<AppReleaseRow>('POST', '/super-admin/downloads', dto),
    update: (id: string, dto: Partial<AppReleaseInput>) =>
      request<AppReleaseRow>('PATCH', `/super-admin/downloads/${id}`, dto),
    publish: (id: string) => request<AppReleaseRow>('POST', `/super-admin/downloads/${id}/publish`),
    remove: (id: string) => request<{ deleted: boolean }>('DELETE', `/super-admin/downloads/${id}`),
  },

  // ── Landing — gestão pelo Super Admin ──────────────────────
  landingAdmin: {
    get: () => request<LandingConfig>('GET', '/super-admin/landing'),
    update: (dto: Partial<LandingConfig>) =>
      request<LandingConfig>('PATCH', '/super-admin/landing', dto),
    listPlans: () => request<PublicPlan[]>('GET', '/super-admin/landing/plans'),
    updatePlan: (id: string, dto: Partial<PublicPlan>) =>
      request<PublicPlan>('PATCH', `/super-admin/landing/plans/${id}`, dto),
  },

  // ── Subscrições — pagamento da plataforma ──────────────────
  // Contas bancárias (público p/ escolher; admin p/ gerir)
  banks: () => request<BankAccount[]>('GET', '/subscription/bank-accounts', undefined, { auth: false }),
  // Planos públicos (para a empresa escolher/renovar)
  plans: () => request<PublicPlan[]>('GET', '/landing/plans', undefined, { auth: false }),
  // Lado da EMPRESA (gestor)
  subscription: {
    mine: () => request<Subscription[]>('GET', '/subscription/mine'),
    create: (dto: { planId: string; method: 'IBAN' | 'REFERENCE'; bankAccountId?: string }) =>
      request<Subscription>('POST', '/subscription', dto),
    get: (id: string) => request<Subscription>('GET', `/subscription/${id}`),
    submitProof: (id: string, dto: { fileName: string; fileType: string; fileData: string; amountKz?: number; note?: string }) =>
      request<Subscription>('POST', `/subscription/${id}/proof`, dto),
    messages: (id: string) => request<SubMessage[]>('GET', `/subscription/${id}/messages`),
    send: (id: string, body: string) => request<SubMessage>('POST', `/subscription/${id}/messages`, { body }),
  },
  // Lado do SUPER ADMIN
  subsAdmin: {
    list: (status?: string) =>
      request<Subscription[]>('GET', `/super-admin/subscriptions${status ? `?status=${status}` : ''}`),
    get: (id: string) => request<Subscription>('GET', `/super-admin/subscriptions/${id}`),
    review: (id: string, decision: 'APPROVE' | 'REJECT', note?: string) =>
      request<Subscription>('PATCH', `/super-admin/subscriptions/${id}/review`, { decision, note }),
    send: (id: string, body: string) =>
      request<SubMessage>('POST', `/super-admin/subscriptions/${id}/messages`, { body }),
    banksAll: () => request<BankAccount[]>('GET', '/super-admin/subscriptions/banks/all'),
    createBank: (dto: Omit<BankAccount, 'id'>) =>
      request<BankAccount>('POST', '/super-admin/subscriptions/banks', dto),
    updateBank: (id: string, dto: Partial<BankAccount>) =>
      request<BankAccount>('PATCH', `/super-admin/subscriptions/banks/${id}`, dto),
  },
  refresh: (refreshToken: string) =>
    request<TokenPair>('POST', '/auth/refresh', { refreshToken }, { auth: false }),
  logout: (refreshToken: string) =>
    request<void>('POST', '/auth/logout', { refreshToken }, { auth: false }),

  tenants: {
    list: (params: { status?: CompanyStatus; search?: string }) => {
      const q = new URLSearchParams();
      if (params.status) q.set('status', params.status);
      if (params.search) q.set('search', params.search);
      const qs = q.toString();
      return request<Company[]>('GET', `/super-admin/tenants${qs ? `?${qs}` : ''}`);
    },
    approve: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/approve`),
    reject: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/reject`),
    suspend: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/suspend`),
    reactivate: (id: string) => request<Company>('POST', `/super-admin/tenants/${id}/reactivate`),
    grantBonus: (id: string, dto: { days?: number; months?: number; note?: string }) =>
      request<Company>('POST', `/super-admin/tenants/${id}/bonus`, dto),
    changePlan: (id: string, planTier: string) =>
      request<Company>('PATCH', `/super-admin/tenants/${id}/plan`, { planTier }),
    resetPassword: (id: string, email?: string) =>
      request<{ email: string; temporaryPassword: string }>('POST', `/super-admin/tenants/${id}/reset-password`, email ? { email } : {}),
    exportData: (id: string) => request<unknown>('GET', `/super-admin/tenants/${id}/export`),
    remove: (id: string) => request<{ deleted: boolean }>('DELETE', `/super-admin/tenants/${id}`),
    impersonate: (id: string) =>
      request<{ tokens: TokenPair; companyCode: string; companyName: string; email: string }>('POST', `/super-admin/tenants/${id}/impersonate`),
  },

  ai: {
    listProviders: () => request<AiProvider[]>('GET', '/super-admin/ai/providers'),
    createProvider: (dto: CreateProviderInput) =>
      request<AiProvider>('POST', '/super-admin/ai/providers', dto),
    updateProvider: (id: string, dto: Partial<CreateProviderInput>) =>
      request<AiProvider>('PATCH', `/super-admin/ai/providers/${id}`, dto),
    deleteProvider: (id: string) =>
      request<{ id: string }>('DELETE', `/super-admin/ai/providers/${id}`),
    testProvider: (id: string) =>
      request<{ ok?: boolean; [k: string]: unknown }>('POST', `/super-admin/ai/providers/${id}/test`),
    getAssistant: () => request<AssistantConfig>('GET', '/super-admin/ai/assistant'),
    updateAssistant: (dto: Partial<AssistantConfig>) =>
      request<AssistantConfig>('PATCH', '/super-admin/ai/assistant', dto),
  },

  fiscal: {
    get: () => request<AgtConfig>('GET', '/super-admin/fiscal/agt'),
    update: (dto: UpdateAgtInput) => request<AgtConfig>('PATCH', '/super-admin/fiscal/agt', dto),
    subscribe: () => request<AgtConfig>('POST', '/super-admin/fiscal/agt/subscribe'),
    // Chave de assinatura da PLATAFORMA (portal AGT) — a privada nunca sai do servidor.
    signingKey: () => request<PlatformSigningStatus>('GET', '/super-admin/fiscal/agt/signing-key'),
    provisionSigningKey: () => request<PlatformSigningStatus>('POST', '/super-admin/fiscal/agt/signing-key'),
    exportPublicKey: () =>
      request<{ fileName: string; pem: string; keyVersion: number; algorithm: string }>(
        'GET', '/super-admin/fiscal/agt/signing-key/export'),
    // Facturação Electrónica (DP 71/25 · DE 683/25)
    feConfig: () => request<Record<string, any>>('GET', '/super-admin/fiscal/einvoice/config'),
    feUpdate: (dto: Record<string, unknown>) => request<Record<string, any>>('PATCH', '/super-admin/fiscal/einvoice/config', dto),
    feProvisionKey: () => request<Record<string, any>>('POST', '/super-admin/fiscal/einvoice/software-key', {}),
    feExportKey: () => request<{ fileName: string; pem: string; signatureVersion: number }>('GET', '/super-admin/fiscal/einvoice/software-key/export'),
    feCompany: (id: string) => request<Record<string, any>>('GET', `/super-admin/fiscal/einvoice/company/${id}`),
    feSaveCompany: (id: string, dto: Record<string, unknown>) => request<Record<string, any>>('PUT', `/super-admin/fiscal/einvoice/company/${id}`, dto),
    feRequestSeries: (id: string, dto: { documentType: string; year: number }) => request<Record<string, any>>('POST', `/super-admin/fiscal/einvoice/company/${id}/series`, dto),
    feSync: (id: string) => request<Record<string, any>>('POST', `/super-admin/fiscal/einvoice/company/${id}/sync`, {}),
    feDocuments: (id: string, status?: string) => request<Array<Record<string, any>>>('GET', `/super-admin/fiscal/einvoice/company/${id}/documents${status ? `?status=${status}` : ''}`),
    feRequeue: (id: string, documentNo: string) => request<Record<string, any>>('POST', `/super-admin/fiscal/einvoice/company/${id}/requeue`, { documentNo }),
  },

  integrations: {
    list: () => request<Integration[]>('GET', '/super-admin/integrations'),
    update: (key: string, dto: UpdateIntegrationInput) =>
      request<Integration>('PATCH', `/super-admin/integrations/${key}`, dto),
    test: (key: string) => request<{ ok: boolean; status: string }>('POST', `/super-admin/integrations/${key}/test`),
  },
  gateways: {
    list: () => request<Gateway[]>('GET', '/super-admin/payment-gateways'),
    create: (dto: CreateGatewayInput) =>
      request<Gateway>('POST', '/super-admin/payment-gateways', dto),
    update: (id: string, dto: Partial<CreateGatewayInput>) =>
      request<Gateway>('PATCH', `/super-admin/payment-gateways/${id}`, dto),
    remove: (id: string) =>
      request<{ id: string }>('DELETE', `/super-admin/payment-gateways/${id}`),
  },

  // ── Back-office do GESTOR da empresa ───────────────────────
  products: {
    /** Página/pesquisa de produtos (catálogos grandes: nunca a lista inteira). Sem
     *  opções devolve os primeiros 1000 — para escolhas rápidas em formulários. */
    list: (o?: CatalogQuery) => request<ManagerProduct[]>('GET', `/pos/products${catalogQs(o ?? { limit: 1000 })}`),
    /** Catálogo do gestor: inclui os inativos (para os poder reativar ou eliminar). */
    /** Totais do catálogo inteiro (os cartões não podem contar só a página carregada). */
    stats: () => request<{ sellable: number; ingredients: number; inactive: number; outOfStock: number; online: number; stockValue: number }>('GET', '/pos/products/stats'),
    listAll: (o?: CatalogQuery) => request<ManagerProduct[]>('GET', `/pos/products/all${catalogQs(o ?? { limit: 1000 })}`),
    /** Alterações do catálogo (memória interna aos poucos). */
    changes: (since: string, after: string, limit = 5000) =>
      request<{ items: ManagerProduct[]; next: { since: string; after: string } | null }>(
        'GET', `/pos/products/changes?limit=${limit}&since=${encodeURIComponent(since)}&after=${encodeURIComponent(after)}`, undefined, { timeoutMs: 120_000 }),
    /** Ingredientes/matéria-prima (não vendíveis; para a ficha técnica). */
    ingredients: () => request<ManagerProduct[]>('GET', '/pos/products/ingredients'),
    create: (dto: CreateProductInput) => request<ManagerProduct>('POST', '/pos/products', dto),
    update: (id: string, dto: UpdateProductInput) =>
      request<ManagerProduct>('PATCH', `/pos/products/${id}`, dto),
    remove: (id: string) =>
      request<{ deleted: boolean; deactivated: boolean }>('DELETE', `/pos/products/${id}`),
    /** Elimina vários de uma só vez (os com vendas são só desativados). */
    removeMany: (ids: string[]) =>
      // Operação pesada (até centenas de produtos e o que deles depende): tempo
      // próprio e sem fila offline — nunca devolve uma resposta provisória sem contagens.
      request<{ deleted: number; deactivated: number }>('POST', '/pos/products/bulk-delete', { ids }, { timeoutMs: 120_000, queue: false }),
    /** Ordem de produção (fornada): consome os ingredientes da ficha técnica e
     *  dá entrada do produto acabado no stock (padaria/pastelaria/produção). */
    produce: (dto: { productCode: string; quantity: number; note?: string }) =>
      request<{ produced: number; unitCost: number; costPrice: number; stockAfter: number }>('POST', '/restaurant/production', dto),
  },
  orders: {
    list: () => request<WebOrder[]>('GET', '/ecommerce/orders'),
    pendingCount: () => request<{ count: number }>('GET', '/ecommerce/orders/count/pending'),
    get: (id: string) => request<WebOrderDetail>('GET', `/ecommerce/orders/${id}`),
    pay: (id: string) =>
      request<{ orderId: string; invoiceNumber: string }>('POST', `/ecommerce/orders/${id}/pay`),
    ship: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/ship`),
    deliver: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/deliver`),
    cancel: (id: string) => request<{ status: string }>('POST', `/ecommerce/orders/${id}/cancel`),
    messages: (id: string) => request<OrderMessage[]>('GET', `/ecommerce/orders/${id}/messages`),
    reply: (id: string, body: string, senderName?: string) =>
      request<OrderMessage>('POST', `/ecommerce/orders/${id}/messages`, { body, senderName }),
    confirmReference: (input: { entity?: string; reference: string; amount?: number }) =>
      request<{ orderId: string; invoiceNumber: string | null; status: string; alreadyPaid: boolean }>(
        'POST', '/ecommerce/orders/reference/confirm', input),
    location: (id: string) => request<OrderLocation>('GET', `/ecommerce/orders/${id}/location`),
  },
  advances: {
    pending: () => request<SalaryAdvanceReq[]>('GET', '/hr/salary-advance/pending'),
    pendingCount: () => request<{ count: number }>('GET', '/hr/salary-advance/pending/count'),
    review: (id: string, decision: 'APPROVED' | 'REJECTED', note?: string) =>
      request<{ id: string; status: string }>('POST', `/hr/salary-advance/${id}/review`, { decision, note }),
  },
  site: {
    get: () => request<SiteSettings>('GET', '/site/settings'),
    update: (dto: UpdateSiteSettingsInput) =>
      request<SiteSettings>('PATCH', '/site/settings', dto),
  },
  branding: () => request<DocumentIdentity>('GET', '/fiscal/document-identity'),
  firstSteps: () => request<Record<string, number>>('GET', '/onboarding/first-steps'),
  // ── Promoções + Alertas (gerente) ──────────────────────────
  promotions: {
    list: () => request<Promotion[]>('GET', '/promotions'),
    create: (dto: PromotionInput) => request<Promotion>('POST', '/promotions', dto),
    update: (id: string, dto: Partial<PromotionInput>) => request<Promotion>('PATCH', `/promotions/${id}`, dto),
    remove: (id: string) => request<{ id: string }>('DELETE', `/promotions/${id}`),
  },
  alerts: () => request<OpsAlert[]>('GET', '/alerts'),
  // ── Visão geral do gestor (dashboard em tempo real) ────────
  dashboard: {
    salesToday: (storeId?: string) => request<DashSalesSummary>('GET', `/dashboard/sales/today${qs({ storeId })}`),
    series: (range = '7d', storeId?: string) => request<DashSalesSeries>('GET', `/dashboard/sales/series${qs({ range, storeId })}`),
    topProducts: (limit = 8, storeId?: string) => request<DashTopProduct[]>('GET', `/dashboard/top-products${qs({ limit: String(limit), storeId })}`),
    lowStock: (storeId?: string) => request<DashLowStock[]>('GET', `/dashboard/low-stock${qs({ storeId })}`),
    salesByStore: (days = 1) => request<DashStoreSales[]>('GET', `/dashboard/sales/by-store${qs({ days: String(days) })}`),
  },
  profit: {
    summary: (from?: string, to?: string, storeId?: string) =>
      request<ProfitSummary>('GET', `/profit/summary${qs({ from, to, storeId })}`),
    series: (from?: string, to?: string, storeId?: string) =>
      request<ProfitPoint[]>('GET', `/profit/series${qs({ from, to, storeId })}`),
    byProduct: (from?: string, to?: string, storeId?: string) =>
      request<ProfitProduct[]>('GET', `/profit/by-product${qs({ from, to, storeId })}`),
    abc: (from?: string, to?: string) =>
      request<ProfitAbcRow[]>('GET', `/profit/abc${qs({ from, to })}`),
  },
  reports: {
    salesByUser: (from?: string, to?: string, storeId?: string) =>
      request<ReportUserRow[]>('GET', `/reports/sales-by-user${qs({ from, to, storeId })}`),
    salesByCategory: (from?: string, to?: string, storeId?: string) =>
      request<ReportCategoryRow[]>('GET', `/reports/sales-by-category${qs({ from, to, storeId })}`),
    salesByCustomer: (from?: string, to?: string, storeId?: string) =>
      request<ReportUserRow[]>('GET', `/reports/sales-by-customer${qs({ from, to, storeId })}`),
    taxMap: (from?: string, to?: string, storeId?: string) =>
      request<ReportTaxRow[]>('GET', `/reports/tax-map${qs({ from, to, storeId })}`),
    paymentMethods: (from?: string, to?: string) =>
      request<ReportPaymentRow[]>('GET', `/reports/payment-methods${qs({ from, to })}`),
    salesByStore: (from?: string, to?: string) =>
      request<ReportUserRow[]>('GET', `/reports/sales-by-store${qs({ from, to })}`),
    salesByBrand: (from?: string, to?: string, storeId?: string) =>
      request<ReportCategoryRow[]>('GET', `/reports/sales-by-brand${qs({ from, to, storeId })}`),
    documents: (f: { from?: string; to?: string; storeId?: string; docType?: string } = {}) =>
      request<ReportDocRow[]>('GET', `/reports/documents${qs(f as Record<string, string>)}`),
    cashSessions: (from?: string, to?: string) =>
      request<ReportCashSession[]>('GET', `/reports/cash-sessions${qs({ from, to })}`),
  },
  expenses: {
    list: (from?: string, to?: string, category?: string) =>
      request<Expense[]>('GET', `/expenses${qs({ from, to, category })}`),
    summary: (from?: string, to?: string) =>
      request<ExpenseSummary>('GET', `/expenses/summary${qs({ from, to })}`),
    create: (dto: CreateExpenseInput) => request<Expense>('POST', '/expenses', dto),
    remove: (id: string) => request<{ id: string }>('DELETE', `/expenses/${id}`),
  },
  commissions: {
    report: (from?: string, to?: string) => request<CommissionReport>('GET', `/commissions${qs({ from, to })}`),
    setRate: (userId: string, rate: number) => request<{ userId: string; rate: number }>('POST', `/commissions/${userId}/rate`, { rate }),
  },
  staff: {
    listStores: () => request<ManagerStore[]>('GET', '/staff/stores'),
    createStore: (dto: CreateStoreInput) => request<ManagerStore>('POST', '/staff/stores', dto),
    updateStore: (id: string, dto: UpdateStoreInput) => request<ManagerStore>('PATCH', `/staff/stores/${id}`, dto),
    deleteStore: (id: string) => request<{ deleted: boolean; deactivated: boolean }>('DELETE', `/staff/stores/${id}`),
    listUsers: () => request<ManagerStaff[]>('GET', '/staff/users'),
    createUser: (dto: CreateStaffInput) => request<CreatedStaff>('POST', '/staff/users', dto),
    updateUser: (id: string, dto: UpdateStaffInput) => request<ManagerStaff>('PATCH', `/staff/users/${id}`, dto),
    resetPassword: (id: string, password?: string) =>
      request<{ temporaryPassword?: string }>('POST', `/staff/users/${id}/reset-password`, password ? { password } : {}),
    setPin: (id: string, pin: string) => request<{ ok: boolean }>('POST', `/staff/users/${id}/set-pin`, { pin }),
    deactivate: (id: string) => request<ManagerStaff>('POST', `/staff/users/${id}/deactivate`),
    unlock: (id: string) => request<ManagerStaff>('POST', `/staff/users/${id}/unlock`),
  },
  restaurant: {
    tableMap: () => request<RestaurantTableMapRow[]>('GET', '/restaurant/table-map'),
    createTable: (dto: { code?: string; name: string; area?: string; seats?: number }) => request<unknown>('POST', '/restaurant/tables', dto),
    removeTable: (id: string) => request<{ ok: boolean }>('DELETE', `/restaurant/tables/${id}`),
    openOrder: (tableId: string, guests?: number, customerName?: string) => request<{ id: string }>('POST', '/restaurant/orders', { tableId, guests, customerName }),
    order: (id: string) => request<RestaurantOrderDetail>('GET', `/restaurant/orders/${id}`),
    addItem: (orderId: string, productCode: string, quantity: number, notes?: string) => request<{ ok: boolean }>('POST', `/restaurant/orders/${orderId}/items`, { productCode, quantity, notes }),
    removeItem: (itemId: string) => request<{ ok: boolean }>('DELETE', `/restaurant/items/${itemId}`),
    itemKitchen: (itemId: string, status: string) => request<{ ok: boolean }>('POST', `/restaurant/items/${itemId}/kitchen`, { status }),
    /** Fatura a comanda (FT ligada à comanda) e fecha-a. */
    invoiceOrder: (id: string, dto: { paymentType: string; tendered?: number }) =>
      request<{ invoiceId: string; invoiceNumber: string; grossTotal: number }>('POST', `/restaurant/orders/${id}/invoice`, dto),
    closeOrder: (id: string, chargeToReservationId?: string) => request<{ ok: boolean; chargedToFolio?: boolean }>('POST', `/restaurant/orders/${id}/close`, chargeToReservationId ? { chargeToReservationId } : {}),
    kitchen: () => request<RestaurantKitchenItem[]>('GET', '/restaurant/kitchen'),
    dashboard: () => request<RestaurantDashboard>('GET', '/restaurant/dashboard'),
    onlineQueue: () => request<RestaurantOnlineTicket[]>('GET', '/restaurant/online-queue'),
    setOnlineEta: (orderId: string, minutes: number) => request<{ ok: boolean; etaMin: number }>('POST', `/restaurant/online/${orderId}/eta`, { minutes }),
    advanceOnline: (orderId: string, status: string) => request<{ ok: boolean }>('POST', `/restaurant/online/${orderId}/kitchen`, { status }),
    setOrderEta: (orderId: string, minutes: number) => request<{ ok: boolean; etaMin: number }>('POST', `/restaurant/orders/${orderId}/eta`, { minutes }),
    setPriority: (orderId: string, priority: number) => request<{ ok: boolean; priority: number }>('POST', `/restaurant/orders/${orderId}/priority`, { priority }),
    recipe: (productId: string) => request<RecipeIngredient[]>('GET', `/restaurant/recipe/${productId}`),
    setRecipe: (productId: string, items: { ingredientCode: string; quantity: number; wastePct?: number }[]) => request<{ ok: boolean }>('POST', `/restaurant/recipe/${productId}`, { items }),
    recomputeCosts: () => request<{ ok: boolean }>('POST', '/restaurant/recipes/recompute-costs', {}),
    availability: () => request<{ id: string; name: string; stock: number; inProduction: number; status: 'FREE' | 'BUSY' | 'OUT' }[]>('GET', '/restaurant/availability'),
    report: (days: number) => request<RestaurantSalesReport>('GET', `/restaurant/reports?days=${days}`),
    cancelOrder: (orderId: string, reason: string) =>
      request<{ ok: boolean; cancelled: { tableName: string | null; total: number } }>('POST', `/restaurant/orders/${orderId}/cancel`, { reason }),
  },
  hotel: {
    dashboard: () => request<HotelDashboard>('GET', '/hotel/dashboard'),
    roomMap: () => request<HotelRoomMapRow[]>('GET', '/hotel/room-map'),
    createRoom: (dto: Record<string, unknown>) => request<unknown>('POST', '/hotel/rooms', dto),
    removeRoom: (id: string) => request<{ ok: boolean }>('DELETE', `/hotel/rooms/${id}`),
    reservations: (status?: string) => request<HotelReservationRow[]>('GET', `/hotel/reservations${status ? `?status=${status}` : ''}`),
    createReservation: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/hotel/reservations', dto),
    reservation: (id: string) => request<HotelReservationDetail>('GET', `/hotel/reservations/${id}`),
    addFolio: (id: string, dto: Record<string, unknown>) => request<{ ok: boolean }>('POST', `/hotel/reservations/${id}/folio`, dto),
    removeFolio: (itemId: string) => request<{ ok: boolean }>('DELETE', `/hotel/folio/${itemId}`),
    status: (id: string, status: string) => request<{ ok: boolean }>('POST', `/hotel/reservations/${id}/status`, { status }),
    extend: (id: string, checkOut: string) => request<{ ok: boolean; nights: number; checkOut: string; total: number }>('POST', `/hotel/reservations/${id}/extend`, { checkOut }),
    pendingOnline: () => request<{ count: number }>('GET', '/hotel/pending-online'),
    invoice: (id: string) => request<{ invoiceId: string; invoiceNumber: string }>('POST', `/hotel/reservations/${id}/invoice`),
    roomStatus: (id: string, status: string) => request<{ ok: boolean }>('POST', `/hotel/rooms/${id}/status`, { status }),
    housekeeping: (status?: string) => request<HotelHousekeepingRow[]>('GET', `/hotel/housekeeping${status ? `?status=${status}` : ''}`),
    createHousekeeping: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/hotel/housekeeping', dto),
    doneHousekeeping: (id: string) => request<{ ok: boolean }>('POST', `/hotel/housekeeping/${id}/done`),
    maintenance: (status?: string) => request<HotelMaintenanceRow[]>('GET', `/hotel/maintenance${status ? `?status=${status}` : ''}`),
    createMaintenance: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/hotel/maintenance', dto),
    maintenanceStatus: (id: string, status: string) => request<{ ok: boolean }>('POST', `/hotel/maintenance/${id}/status`, { status }),
  },
  clinic: {
    metrics: () => request<{ todayAppointments: number; todayConsultations: number; patients: number; revenue30: number }>('GET', '/clinic/metrics'),
    dashboard: () => request<ClinicDashboard>('GET', '/clinic/dashboard'),
    patients: (search?: string) => request<ClinicPatient[]>('GET', `/clinic/patients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    createPatient: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/patients', dto),
    patient: (id: string) => request<ClinicPatientDetail>('GET', `/clinic/patients/${id}`),
    updatePatient: (id: string, dto: Record<string, unknown>) => request<{ ok: boolean }>('PATCH', `/clinic/patients/${id}`, dto),
    appointments: (day?: string) => request<ClinicAppointment[]>('GET', `/clinic/appointments${day ? `?day=${day}` : ''}`),
    createAppointment: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/appointments', dto),
    appointmentStatus: (id: string, status: string) => request<{ ok: boolean }>('POST', `/clinic/appointments/${id}/status`, { status }),
    createConsultation: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/consultations', dto),
    invoiceConsultation: (id: string) => request<{ invoiceId: string | null; invoiceNumber: string | null; covered?: number; copay?: number; insurer?: string | null }>('POST', `/clinic/consultations/${id}/invoice`),
    // ── HOSPITAL (HIS) ──
    patientRecord: (id: string) => request<ClinicPatientRecord>('GET', `/clinic/patients/${id}/record`),
    professionals: (category?: string) => request<ClinicProfessional[]>('GET', `/clinic/professionals${category ? `?category=${category}` : ''}`),
    createProfessional: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/professionals', dto),
    updateProfessional: (id: string, dto: Record<string, unknown>) => request<{ ok: boolean }>('PATCH', `/clinic/professionals/${id}`, dto),
    medications: (search?: string) => request<ClinicMedication[]>('GET', `/clinic/medications${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    prescriptions: (status?: string) => request<ClinicPrescriptionRow[]>('GET', `/clinic/prescriptions${status ? `?status=${status}` : ''}`),
    createPrescription: (dto: Record<string, unknown>) => request<{ id: string; number: string }>('POST', '/clinic/prescriptions', dto),
    prescription: (id: string) => request<ClinicPrescriptionDetail>('GET', `/clinic/prescriptions/${id}`),
    dispense: (id: string) => request<{ ok: boolean; number: string }>('POST', `/clinic/prescriptions/${id}/dispense`, {}),
    cancelPrescription: (id: string) => request<{ ok: boolean }>('POST', `/clinic/prescriptions/${id}/cancel`, {}),
    invoicePrescription: (id: string) => request<{ invoiceId: string; invoiceNumber: string }>('POST', `/clinic/prescriptions/${id}/invoice`),
    addVitals: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/vitals', dto),
    beds: () => request<ClinicBed[]>('GET', '/clinic/beds'),
    createBed: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/beds', dto),
    bedStatus: (id: string, status: string) => request<{ ok: boolean }>('POST', `/clinic/beds/${id}/status`, { status }),
    admissions: (status?: string) => request<ClinicAdmission[]>('GET', `/clinic/admissions${status ? `?status=${status}` : ''}`),
    admit: (dto: Record<string, unknown>) => request<{ id: string; number: string }>('POST', '/clinic/admissions', dto),
    discharge: (id: string, outcome?: string) => request<{ ok: boolean; days: number; total: number }>('POST', `/clinic/admissions/${id}/discharge`, { outcome }),
    invoiceAdmission: (id: string) => request<{ invoiceId: string | null; invoiceNumber: string | null; covered?: number; copay?: number; insurer?: string | null }>('POST', `/clinic/admissions/${id}/invoice`),
    emergency: () => request<ClinicTriageRow[]>('GET', '/clinic/emergency'),
    triage: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/emergency', dto),
    triageStatus: (id: string, status: string) => request<{ ok: boolean }>('POST', `/clinic/emergency/${id}/status`, { status }),
    exams: (status?: string) => request<ClinicExamRow[]>('GET', `/clinic/exams${status ? `?status=${status}` : ''}`),
    requestExam: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/exams', dto),
    examStatus: (id: string, status: string, resultText?: string) => request<{ ok: boolean }>('POST', `/clinic/exams/${id}/status`, { status, resultText }),
    invoiceExam: (id: string) => request<{ invoiceId: string | null; invoiceNumber: string | null; covered?: number; copay?: number; insurer?: string | null }>('POST', `/clinic/exams/${id}/invoice`),
    insurers: () => request<ClinicInsurer[]>('GET', '/clinic/insurers'),
    createInsurer: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/clinic/insurers', dto),
    assignInsurer: (patientId: string, insurerId: string | null) => request<{ ok: boolean }>('POST', `/clinic/patients/${patientId}/insurer`, { insurerId }),
    claims: (status?: string) => request<ClinicClaim[]>('GET', `/clinic/claims${status ? `?status=${status}` : ''}`),
    claimStatus: (id: string, status: string) => request<{ ok: boolean }>('POST', `/clinic/claims/${id}/status`, { status }),
  },
  pharmacy: {
    metrics: () => request<{ expiring: number; expired: number; prescription: number; lowStock: number }>('GET', '/pharmacy/metrics'),
    expiring: (days = 30) => request<PharmacyBatch[]>('GET', `/pharmacy/expiring?days=${days}`),
  },
  serviceOrders: {
    dashboard: () => request<ServicesDashboard>('GET', '/service-orders/dashboard'),
    list: (status?: string) => request<ServiceOrderRow[]>('GET', `/service-orders${status ? `?status=${status}` : ''}`),
    create: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/service-orders', dto),
    get: (id: string) => request<ServiceOrderDetail>('GET', `/service-orders/${id}`),
    update: (id: string, dto: Record<string, unknown>) => request<{ ok: boolean }>('PATCH', `/service-orders/${id}`, dto),
    addItem: (id: string, dto: Record<string, unknown>) => request<{ ok: boolean; lowStock?: boolean; lowStockName?: string | null; inStock?: number }>('POST', `/service-orders/${id}/items`, dto),
    removeItem: (itemId: string) => request<{ ok: boolean }>('DELETE', `/service-orders/items/${itemId}`),
    status: (id: string, status: string) => request<{ ok: boolean }>('POST', `/service-orders/${id}/status`, { status }),
    pendingOnline: () => request<{ count: number }>('GET', '/service-orders/pending-online'),
    invoice: (id: string) => request<{ invoiceId: string; invoiceNumber: string }>('POST', `/service-orders/${id}/invoice`),
    // Mecânica (oficina auto)
    receive: (id: string, dto: Record<string, unknown>) => request<{ ok: boolean }>('POST', `/service-orders/${id}/receive`, dto),
    approveQuote: (id: string, approvedBy?: string) => request<{ ok: boolean }>('POST', `/service-orders/${id}/approve-quote`, { approvedBy }),
    startWork: (id: string) => request<{ ok: boolean }>('POST', `/service-orders/${id}/start-work`, {}),
    finishWork: (id: string) => request<{ ok: boolean }>('POST', `/service-orders/${id}/finish-work`, {}),
    schedule: (id: string, scheduledAt?: string) => request<{ ok: boolean }>('POST', `/service-orders/${id}/schedule`, { scheduledAt }),
    agenda: () => request<ServiceAgendaRow[]>('GET', '/service-orders/agenda'),
    equipments: (customerId?: string) => request<ServiceEquipment[]>('GET', `/service-orders/equipments${customerId ? `?customerId=${customerId}` : ''}`),
    createEquipment: (dto: Record<string, unknown>) => request<{ id: string }>('POST', '/service-orders/equipments', dto),
    updateEquipment: (id: string, dto: Record<string, unknown>) => request<{ ok: boolean }>('PATCH', `/service-orders/equipments/${id}`, dto),
  },
  vertical: {
    metrics: () => request<VerticalMetrics>('GET', '/vertical/metrics'),
  },
  sales: {
    /** Detalhe de um documento emitido (2ª via) — para reimprimir/gerar PDF. */
    detail: (id: string) => request<SaleDetail>('GET', `/pos/invoices/${id}`),
  },
  customerChat: {
    contacts: () => request<CustomerContact[]>('GET', '/ecommerce/customer-chat/contacts'),
    messages: (customer: string) => request<CustomerChatMessage[]>('GET', `/ecommerce/customer-chat/messages?customer=${encodeURIComponent(customer)}`),
    send: (customerId: string, body: string) => request<CustomerChatMessage>('POST', '/ecommerce/customer-chat/messages', { customerId, body }),
    markRead: (customerId: string) => request<{ ok: boolean }>('POST', '/ecommerce/customer-chat/read', { customerId }),
    remove: (ids: string[]) => request<{ deleted: number }>('POST', '/ecommerce/customer-chat/delete', { ids }),
    unread: () => request<{ count: number }>('GET', '/ecommerce/customer-chat/unread'),
  },
  chat: {
    contacts: () => request<ChatContact[]>('GET', '/chat/contacts'),
    messages: (peer: string) => request<ChatMessage[]>('GET', `/chat/messages?peer=${encodeURIComponent(peer)}`),
    send: (recipientId: string, body: string) => request<ChatMessage>('POST', '/chat/messages', { recipientId, body }),
    markRead: (peerId: string) => request<{ ok: boolean }>('POST', '/chat/read', { peerId }),
    remove: (ids: string[]) => request<{ deleted: number }>('POST', '/chat/delete', { ids }),
    unread: () => request<{ count: number }>('GET', '/chat/unread'),
  },
  hr: {
    employees: (all?: boolean) => request<ManagerEmployee[]>('GET', `/hr/employees${all ? '?all=true' : ''}`),
    createEmployee: (dto: CreateEmployeeInput) => request<ManagerEmployee>('POST', '/hr/employees', dto),
    updateEmployee: (id: string, dto: UpdateEmployeeInput) => request<ManagerEmployee>('PATCH', `/hr/employees/${id}`, dto),
    terminateEmployee: (id: string) => request<ManagerEmployee>('POST', `/hr/employees/${id}/terminate`, {}),
    reactivateEmployee: (id: string) => request<ManagerEmployee>('POST', `/hr/employees/${id}/reactivate`, {}),
    removeEmployee: (id: string) => request<{ deleted: boolean; deactivated: boolean }>('DELETE', `/hr/employees/${id}`),
    payroll: {
      listRuns: () => request<PayrollRun[]>('GET', '/hr/payroll/runs'),
      getRun: (id: string) => request<PayrollRunDetail>('GET', `/hr/payroll/runs/${id}`),
      process: (year: number, month: number, adjustments?: { employeeId: string; bonus?: number; absenceDays?: number }[]) =>
        request<PayrollRun>('POST', '/hr/payroll/runs', { year, month, adjustments }),
      pay: (id: string) => request<PayrollRun>('POST', `/hr/payroll/runs/${id}/pay`, {}),
    },
    consumptions: (status?: string) =>
      request<EmployeeConsumption[]>('GET', `/hr/self-consumption${status ? `?status=${status}` : ''}`),
  },
  // ── Assistente OpenManus da empresa (chat) ────────────────
  assistant: {
    greeting: () => request<AssistantGreeting>('GET', '/ai/greeting'),
    history: () => request<{ id: string; role: 'user' | 'assistant'; content: string; created_at: string }[]>('GET', '/ai/history'),
    clearHistory: () => request<{ ok: boolean }>('POST', '/ai/history/clear'),
    chat: (messages: AssistantMessage[]) =>
      request<AssistantChatReply>('POST', '/ai/chat', { messages, channel: 'chat' }),
    tts: (text: string, voice?: string) =>
      request<AssistantTts>('POST', '/ai/voice/tts', { text, voice }),
    stt: (audioBase64: string, mimeType?: string) =>
      request<{ text: string }>('POST', '/ai/voice/stt', { audioBase64, mimeType }),
    voiceTurn: (audioBase64: string, mimeType?: string) =>
      request<AssistantVoiceTurn>('POST', '/ai/voice/turn', { audioBase64, mimeType }),
    callSession: () => request<AssistantCallSession>('GET', '/ai/call/session'),
  },
  // ── Clientes da empresa (mesma tabela que o caixa usa) ─────
  customers: {
    /** Totais de todos os clientes (cartões da Gestão). */
    stats: () => request<{ total: number; withPurchases: number; totalSpent: number; purchases: number }>('GET', '/pos/customers/stats'),
    /** Alterações de clientes (memória interna aos poucos). */
    changes: (since: string, after: string, limit = 5000) =>
      request<{ items: CustomerRow[]; next: { since: string; after: string } | null }>(
        'GET', `/pos/customers/changes?limit=${limit}&since=${encodeURIComponent(since)}&after=${encodeURIComponent(after)}`, undefined, { timeoutMs: 120_000 }),
    /** Página + pesquisa no servidor (nome, NIF, telefone, e-mail). */
    list: (o: { q?: string; limit?: number } = {}) =>
      request<CustomerRow[]>('GET', `/pos/customers?limit=${o.limit ?? 500}${o.q ? `&q=${encodeURIComponent(o.q)}` : ''}`),
    create: (input: { name: string; taxId?: string; email?: string; phone?: string; address?: string }) =>
      request<CustomerRow>('POST', '/pos/customers', input),
    update: (id: string, input: { name?: string; taxId?: string; email?: string; phone?: string; address?: string; province?: string; municipality?: string }) =>
      request<CustomerRow>('PATCH', `/pos/customers/${id}`, input),
    remove: (id: string) => request<{ deleted: boolean; deactivated: boolean }>('DELETE', `/pos/customers/${id}`),
  },

  // ── Câmaras de vigilância ───────────────────────────────────
  cameras: {
    list: () => request<CameraRow[]>('GET', '/cameras'),
    /** Câmaras PÚBLICAS (Windy Webcams) perto de um ponto — configuradas no Super Admin. */
    publicNearby: (lat: number, lng: number, radiusKm = 25) =>
      request<PublicWebcamsResult>('GET', `/cameras/public/nearby?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&radiusKm=${radiusKm}`),
    create: (input: CameraInput) => request<CameraRow>('POST', '/cameras', input),
    update: (id: string, input: Partial<CameraInput>) => request<CameraRow>('PATCH', `/cameras/${id}`, input),
    test: (id: string) => request<{ ok: boolean; status: number; contentType: string | null; kind: string; warning?: string; secure?: boolean }>('POST', `/cameras/${id}/test`),
    days: (id: string) => request<{ days: string[] }>('GET', `/cameras/${id}/recordings`),
    frames: (id: string, day: string) => request<{ frames: string[] }>('GET', `/cameras/${id}/recordings/${day}`),
    /** Fotograma gravado com autenticação → object URL para <img>. */
    frameUrl: async (id: string, day: string, file: string): Promise<string> => {
      const headers: Record<string, string> = {};
      const token = hooks?.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const code = hooks?.getCompanyCode?.();
      if (code) headers['X-Tenant-Code'] = code;
      const res = await fetch(`${API_URL}/cameras/${id}/recordings/${day}/${file}`, { headers });
      if (!res.ok) throw await parseError(res);
      return URL.createObjectURL(await res.blob());
    },
    /**
     * Fotograma AO VIVO via PROXY autenticado do servidor (resolve mixed-content
     * — site HTTPS ↔ câmara HTTP — e CORS). Para câmaras com URL de fotograma:
     * o player faz polling disto a cada ~1.5 s = vídeo fluido sem expor a câmara.
     */
    liveSnapshotUrl: async (id: string): Promise<string> => {
      const headers: Record<string, string> = {};
      const token = hooks?.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const code = hooks?.getCompanyCode?.();
      if (code) headers['X-Tenant-Code'] = code;
      const res = await fetch(`${API_URL}/cameras/${id}/live?snapshot=1`, { headers });
      if (!res.ok) throw await parseError(res);
      return URL.createObjectURL(await res.blob());
    },
  },

  // ── Compras: fornecedores + encomendas de compra (gestor) ──
  purchasing: {
    listSuppliers: () => request<SupplierRow[]>('GET', '/erp/suppliers'),
    createSupplier: (dto: CreateSupplierInput) => request<SupplierRow>('POST', '/erp/suppliers', dto),
    warehouses: () => request<WarehouseRow[]>('GET', '/erp/warehouses'),
    listOrders: () => request<PurchaseOrderRow[]>('GET', '/erp/purchase-orders'),
    createOrder: (dto: CreatePurchaseOrderInput) =>
      request<{ id: string; number: string }>('POST', '/erp/purchase-orders', dto),
    confirmOrder: (id: string) => request<{ status: string }>('POST', `/erp/purchase-orders/${id}/confirm`, {}),
    receiveOrder: (id: string) => request<{ received: number }>('POST', `/erp/purchase-orders/${id}/receive`, {}),
  },
  leave: {
    list: (status?: string) => request<LeaveRow[]>('GET', `/leave${qs({ status })}`),
    employees: () => request<LeaveEmployee[]>('GET', '/leave/employees'),
    summary: () => request<LeaveSummary>('GET', '/leave/summary'),
    create: (dto: CreateLeaveInput) => request<{ id: string }>('POST', '/leave', dto),
    review: (id: string, decision: 'APPROVED' | 'REJECTED') => request<{ id: string; status: string }>('POST', `/leave/${id}/review`, { decision }),
  },
  reconciliation: {
    importStatement: (rows: ImportStatementRow[]) => request<{ imported: number; matched: number }>('POST', '/reconciliation/import', { rows }),
    list: (filter?: string) => request<BankTx[]>('GET', `/reconciliation${qs({ filter })}`),
    summary: () => request<ReconSummary>('GET', '/reconciliation/summary'),
    match: (id: string) => request<{ id: string }>('POST', `/reconciliation/${id}/match`, {}),
    unmatch: (id: string) => request<{ id: string }>('POST', `/reconciliation/${id}/unmatch`),
  },
  cashflow: {
    summary: (from?: string, to?: string) => request<CashflowSummary>('GET', `/cashflow/summary${qs({ from, to })}`),
    series: (from?: string, to?: string) => request<CashflowPoint[]>('GET', `/cashflow/series${qs({ from, to })}`),
    forecast: () => request<CashflowForecast>('GET', '/cashflow/forecast'),
  },
  receivables: {
    list: (filter?: string) => request<Receivable[]>('GET', `/receivables${qs({ filter })}`),
    summary: () => request<ReceivableSummary>('GET', '/receivables/summary'),
    get: (id: string) => request<ReceivableDetail>('GET', `/receivables/${id}`),
    create: (dto: CreateReceivableInput) => request<{ id: string }>('POST', '/receivables', dto),
    pay: (id: string, dto: RecordPaymentInput) => request<PaymentReceipt>('POST', `/receivables/${id}/payment`, dto),
  },
  payables: {
    list: (filter?: string) => request<Payable[]>('GET', `/payables${qs({ filter })}`),
    summary: () => request<PayableSummary>('GET', '/payables/summary'),
    get: (id: string) => request<PayableDetail>('GET', `/payables/${id}`),
    create: (dto: CreatePayableInput) => request<{ id: string }>('POST', '/payables', dto),
    pay: (id: string, dto: RecordPayablePaymentInput) => request<PayableVoucher>('POST', `/payables/${id}/payment`, dto),
  },

  // ── Auditoria / Caixa / Inventário (gerente) ───────────────
  audit: {
    list: (action?: string, limit = 150) =>
      request<AuditEvent[]>('GET', `/audit?${action ? `action=${action}&` : ''}limit=${limit}`),
    verify: () => request<{ valid: boolean; brokenAtSeq: number | null }>('GET', '/audit/verify'),
    reseal: () => request<{ resealed: number }>('POST', '/audit/verify/reseal'),
  },
  cashbox: {
    sessions: () => request<CashSessionRow[]>('GET', '/cashbox/sessions'),
  },
  inventory: {
    warehouses: () => request<WarehouseRow[]>('GET', '/erp/warehouses'),
    /** Saldos de stock por produto e loja (para mostrar o stock existente ao escolher um produto). */
    stockLevels: () => request<Array<{ product_id: string; warehouse_id: string; warehouse_code: string; quantity: string; min_qty: string | null }>>('GET', '/erp/stock'),
    /** Compara o stock mostrado com os saldos por loja (só relata). */
    stockCheck: () => request<StockCheckResult>('GET', '/inventory/stock-check'),
    /** Cria o saldo por loja dos produtos com stock mas sem saldo (o total mostrado não muda). */
    stockRepair: () => request<{ fixed: number }>('POST', '/inventory/stock-check/repair', {}),
    listCounts: () => request<StockCountRow[]>('GET', '/inventory/counts'),
    createCount: (warehouseId: string, notes?: string) =>
      request<{ id: string; reference: string }>('POST', '/inventory/counts', { warehouseId, notes }),
    getCount: (id: string) => request<StockCountDetail>('GET', `/inventory/counts/${id}`),
    countItem: (id: string, productId: string, countedQty: number) =>
      request<void>('POST', `/inventory/counts/${id}/item`, { productId, countedQty }),
    closeCount: (id: string) => request<{ adjusted: number }>('POST', `/inventory/counts/${id}/close`),
    writeOff: (productId: string, warehouseId: string, quantity: number, reason: string) =>
      request<{ balanceAfter: number }>('POST', '/inventory/write-off', { productId, warehouseId, quantity, reason }),
    stockEntry: (dto: StockEntryInput) =>
      request<{ balanceAfter: number }>('POST', '/erp/stock/entry', dto),
    transfer: (dto: { productId: string; fromStoreId: string; toStoreId: string; quantity: number; note?: string }) =>
      request<{ fromBalance: number; toBalance: number }>('POST', '/erp/stock/transfer', dto),
    addBatch: (dto: BatchInput) => request<{ id: string }>('POST', '/inventory/batches', dto),
    expiringBatches: (days = 60) => request<ExpiringBatch[]>('GET', `/inventory/batches/expiring?days=${days}`),
    movements: (f: { q?: string; warehouseId?: string; from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.q) p.set('q', f.q);
      if (f.warehouseId) p.set('warehouseId', f.warehouseId);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      const qs = p.toString();
      return request<StockMovementRow[]>('GET', `/erp/stock/movements${qs ? '?' + qs : ''}`);
    },
    categories: () => request<{ id: string; name: string }[]>('GET', '/erp/stock/categories'),
    createCategory: (name: string) => request<{ id: string; name: string }>('POST', '/erp/stock/categories', { name }),
    analysis: (f: { from?: string; to?: string; warehouseId?: string; categoryId?: string; state?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      if (f.warehouseId) p.set('warehouseId', f.warehouseId);
      if (f.categoryId) p.set('categoryId', f.categoryId);
      if (f.state) p.set('state', f.state);
      const qs = p.toString();
      return request<StockAnalysis>('GET', `/erp/stock/analysis${qs ? '?' + qs : ''}`);
    },
  },

  // ── Inventário empresarial (ABC, reposição, valorização, antifraude…) ──
  inventoryIntel: {
    abc: (f: { from?: string; to?: string; storeId?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      if (f.storeId) p.set('storeId', f.storeId);
      const qs = p.toString();
      return request<AbcReport>('GET', `/inventory/abc${qs ? '?' + qs : ''}`);
    },
    replenishment: (f: { days?: number; coverage?: number; leadDays?: number; storeId?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.days) p.set('days', String(f.days));
      if (f.coverage) p.set('coverage', String(f.coverage));
      if (f.leadDays) p.set('leadDays', String(f.leadDays));
      if (f.storeId) p.set('storeId', f.storeId);
      const qs = p.toString();
      return request<ReplenishmentReport>('GET', `/inventory/replenishment${qs ? '?' + qs : ''}`);
    },
    valuation: (method?: 'FIFO' | 'LIFO' | 'CMP', storeId?: string) => {
      const p = new URLSearchParams();
      if (method) p.set('method', method);
      if (storeId) p.set('storeId', storeId);
      const qs = p.toString();
      return request<ValuationReport>('GET', `/inventory/valuation${qs ? '?' + qs : ''}`);
    },
    fraudSignals: (days?: number) =>
      request<FraudReport>('GET', `/inventory/fraud-signals${days ? `?days=${days}` : ''}`),
    locations: (f: { storeId?: string; q?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.storeId) p.set('storeId', f.storeId);
      if (f.q) p.set('q', f.q);
      const qs = p.toString();
      return request<LocationRow[]>('GET', `/inventory/locations${qs ? '?' + qs : ''}`);
    },
    setLocation: (productId: string, storeId: string, location: string) =>
      request<{ ok: true }>('POST', '/inventory/locations', { productId, storeId, location }),
    transfers: (status?: string) =>
      request<TransferRequestRow[]>('GET', `/inventory/transfers${status ? `?status=${status}` : ''}`),
    requestTransfer: (dto: { productId: string; fromStoreId: string; toStoreId: string; quantity: number; note?: string }) =>
      request<{ id: string; status: string }>('POST', '/inventory/transfers', dto),
    approveTransfer: (id: string) =>
      request<{ id: string; status: string }>('POST', `/inventory/transfers/${id}/approve`),
    rejectTransfer: (id: string, reason?: string) =>
      request<{ id: string; status: string }>('POST', `/inventory/transfers/${id}/reject`, { reason }),
    receiveTransfer: (id: string) =>
      request<{ id: string; status: string }>('POST', `/inventory/transfers/${id}/receive`),
    auditTrail: (f: { actorId?: string; action?: string; from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (f.actorId) p.set('actorId', f.actorId);
      if (f.action) p.set('action', f.action);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      const qs = p.toString();
      return request<AuditTrailRow[]>('GET', `/inventory/audit${qs ? '?' + qs : ''}`);
    },
    auditFilters: () => request<AuditFilters>('GET', '/inventory/audit/filters'),
  },

  // ── Pagamentos da loja (gerente) ───────────────────────────
  payments: {
    listMethods: () => request<StorePaymentMethod[]>('GET', '/payments/methods'),
    createMethod: (dto: PaymentMethodInput) =>
      request<StorePaymentMethod>('POST', '/payments/methods', dto),
    updateMethod: (id: string, dto: PaymentMethodInput) =>
      request<StorePaymentMethod>('PATCH', `/payments/methods/${id}`, dto),
    deleteMethod: (id: string) => request<{ id: string }>('DELETE', `/payments/methods/${id}`),
    listProofs: (status?: string) =>
      request<PaymentProof[]>('GET', `/payments/proofs${status ? `?status=${status}` : ''}`),
    reviewProof: (id: string, status: 'APPROVED' | 'REJECTED', note?: string) =>
      request<PaymentProof>('POST', `/payments/proofs/${id}/review`, { status, note }),
  },
};
