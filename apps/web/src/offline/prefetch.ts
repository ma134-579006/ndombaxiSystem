/**
 * PREPARAÇÃO AUTOMÁTICA DO APARELHO (apps instaladas).
 *
 * Duas vias, ambas sem o utilizador instalar ou configurar NADA:
 *  · DESKTOP (Windows): um servidor local com réplica da base (processo principal
 *    do Electron — `@nexus/local-server`) cuida de tudo sozinho.
 *  · ANDROID (e restantes apps): esta camada. Ao entrar, a app DESCARREGA para a
 *    memória interna do aparelho as leituras de TODOS os módulos da Gestão (catálogo,
 *    clientes, fornecedores, stock, RH, finanças, restauração, hotel, clínica, …) e
 *    mantém-nas atualizadas em segundo plano (de 10 em 10 min, ao voltar a rede e
 *    ao regressar ao 1.º plano). Sem rede, cada página lê a sua última cópia.
 *    As escritas seguem pelo motor de sincronização (`/sync/push`), que sabe
 *    receber de forma idempotente vendas, clientes e turnos de caixa.
 *
 * Na PRIMEIRA vez (por empresa) mostra o ecrã de progresso em % — "A preparar o
 * aparelho para trabalhar sem internet". Depois corre em silêncio.
 *
 * SEGURO: só LEITURAS (GET). Nada de escrita, nada de documentos fiscais a descer
 * em massa para além do que a própria página já mostra. Best-effort: cada falha é
 * ignorada e nunca quebra a app. NAVEGADOR: não faz nada (100% online).
 */
import { api, prefetchGet, replayQueuedWrites } from '../api/client';
import { isNativeApp } from '../config';
import { runTransfer } from '../components/feedback';

let running = false;
let lastRunAt = 0;
let timer = 0;

/** Áreas que NÃO são da empresa (super admin, público, autenticação, tempo real). */
const SKIP_NS = new Set([
  'support', 'tenants', 'platformDashboard', 'mailAdmin', 'downloadsAdmin', 'landingAdmin', 'subsAdmin',
  'ai', 'integrations', 'gateways', 'onboarding', 'setup', 'chat', 'customerChat', 'assistant',
  'preferences', 'agtComm', 'backup', 'migration', 'cameras', 'audit',
]);
/** Leituras sem argumentos obrigatórios (listas, resumos, painéis…). */
const READ_NAME = /^(list|listAll|all|summary|pending|pendingCount|pendingOnline|metrics|stats|overview|today|top|topProducts|lowStock|salesToday|alerts|ingredients|categories|warehouses|stores|listStores|listUsers|listSuppliers|employees|roomMap|reservations|housekeeping|maintenance|tableMap|tables|kitchen|mine|limit|sessions|counts|listCounts|expiring|expiringBatches|expiring30|analysis|status|get|balance|rooms|beds|patients|appointments|professionals|insurers|exams|prescriptions|orders|equipments|agenda|suppliers|runs|listRuns|methods|salaries)$/;
/** Nunca disparar: exportações, ficheiros, ações com efeitos, mensagens/leitura de chat. */
const BAD_NAME = /download|export|run$|reset|pdf|csv|xml|saft|backup|generate|send|test|unread|poll|verify|provision|token|login|logout|refresh|create|update|delete|remove|set|save|add|mark|reseal|review|apply|process|pay|close|open/i;

type Task = { label: string; call: () => Promise<unknown> };

function collect(): Task[] {
  const out: Task[] = [];
  const root = api as unknown as Record<string, unknown>;
  const consider = (label: string, fn: unknown) => {
    if (typeof fn !== 'function') return;
    const name = label.split('.').pop() as string;
    if (!READ_NAME.test(name) || BAD_NAME.test(name)) return;
    if ((fn as (...a: unknown[]) => unknown).length > 1) return; // exige argumentos → não é uma lista simples
    // `get` só se não tiver parâmetros (ex.: site.get()).
    if (name === 'get' && (fn as (...a: unknown[]) => unknown).length !== 0) return;
    out.push({ label, call: () => (fn as () => Promise<unknown>).call(undefined) });
  };
  for (const [k, v] of Object.entries(root)) {
    if (SKIP_NS.has(k)) continue;
    if (typeof v === 'function') { consider(k, v); continue; }
    if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) consider(`${k}.${k2}`, v2);
    }
  }
  return out;
}

/**
 * TODAS as leituras da Gestão (lista tirada de api/client.ts): o 1.º login guarda
 * cada área na memória interna, para todas as páginas abrirem sem rede. Ficam de
 * fora só as que precisam de internet por natureza (chat, notificações, IA) e as
 * de plataforma (super admin). Caminhos que o servidor recusa para esta empresa
 * (403/404 — outro setor de negócio) não voltam a ser pedidos nesta sessão.
 */
const ALL_READS = [
  '/alerts', '/audit', '/backup', '/backup/settings', '/cameras', '/cashbox/sessions',
  '/cashflow/forecast', '/cashflow/series', '/cashflow/summary', '/commissions',
  '/dashboard/low-stock', '/dashboard/sales/by-store?days=7', '/dashboard/sales/series', '/dashboard/sales/today', '/dashboard/top-products',
  '/ecommerce/orders', '/ecommerce/orders/count/pending',
  '/erp/purchase-orders', '/erp/stock/analysis', '/erp/stock/categories', '/erp/stock/movements', '/erp/suppliers', '/erp/warehouses',
  '/expenses', '/expenses/summary',
  '/fiscal/agt/status', '/fiscal/document-identity', '/fiscal/receipt-info',
  '/hr/employees', '/hr/payroll/runs', '/hr/salary-advance/pending', '/hr/salary-advance/pending/count', '/hr/self-consumption',
  '/inventory/abc', '/inventory/audit', '/inventory/audit/filters', '/inventory/batches/expiring?days=30', '/inventory/counts',
  '/inventory/fraud-signals', '/inventory/locations', '/inventory/replenishment', '/inventory/transfers', '/inventory/valuation',
  '/landing/plans', '/leave', '/leave/employees', '/leave/summary',
  '/onboarding/my-plan', '/onboarding/setup-status',
  '/payables', '/payables/summary', '/payments/methods', '/payments/proofs',
  '/pos/customers', '/pos/products', '/pos/products/all', '/pos/products/ingredients',
  '/profit/abc', '/profit/by-product', '/profit/series', '/profit/summary', '/promotions', '/public/landing',
  '/receivables', '/receivables/summary', '/reconciliation', '/reconciliation/summary',
  '/reports/cash-sessions', '/reports/documents', '/reports/payment-methods', '/reports/sales-by-brand', '/reports/sales-by-category',
  '/reports/sales-by-customer', '/reports/sales-by-store', '/reports/sales-by-user', '/reports/tax-map',
  '/site/settings', '/staff/stores', '/staff/users', '/subscription/bank-accounts', '/subscription/mine', '/vertical/metrics',
  // Setores (só respondem na empresa do setor certo; as restantes dão 403/404 e saem da lista)
  '/restaurant/availability', '/restaurant/dashboard', '/restaurant/kitchen', '/restaurant/online-queue', '/restaurant/table-map', '/restaurant/reports?days=7',
  '/hotel/dashboard', '/hotel/pending-online', '/hotel/room-map', '/hotel/reservations', '/hotel/housekeeping', '/hotel/maintenance',
  '/clinic/beds', '/clinic/dashboard', '/clinic/emergency', '/clinic/insurers', '/clinic/metrics', '/clinic/admissions', '/clinic/appointments',
  '/clinic/claims', '/clinic/exams', '/clinic/medications', '/clinic/patients', '/clinic/prescriptions', '/clinic/professionals',
  '/pharmacy/metrics', '/pharmacy/expiring?days=90',
  '/service-orders', '/service-orders/agenda', '/service-orders/dashboard', '/service-orders/pending-online', '/service-orders/equipments',
];
const recusados = new Set<string>();

function rawTasks(): Task[] {
  return ALL_READS.filter((p) => !recusados.has(p)).map((p) => ({
    label: p,
    call: () => prefetchGet(p).catch((e: unknown) => {
      const st = (e as { status?: number }).status;
      if (st === 403 || st === 404) recusados.add(p);
      throw e;
    }),
  }));
}

const flagKey = (company: string) => `ndombaxi.device-ready.${company}`;
const hasPrepared = (company: string) => { try { return localStorage.getItem(flagKey(company)) !== null; } catch { return false; } };
const markPrepared = (company: string) => { try { localStorage.setItem(flagKey(company), String(Date.now())); } catch { /* ignora */ } };

/** Corre as leituras com concorrência limitada; devolve quantas responderam. */
async function runAll(tasks: Task[], onProgress?: (done: number, total: number) => void): Promise<number> {
  let next = 0; let done = 0; let ok = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      try { await t.call(); ok++; } catch { /* best-effort */ }
      done++; onProgress?.(done, tasks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, worker));
  return ok;
}

/** Prepara/atualiza a cópia local. `company` identifica a empresa (1.ª vez = ecrã de progresso). */
export async function prefetchTenantData(company?: string | null): Promise<void> {
  if (!isNativeApp()) return; // navegador: 100% online, nada a pré-carregar para offline
  if (running || Date.now() - lastRunAt < 30_000) return;
  running = true;
  try {
    const tasks = [...collect(), ...rawTasks()];
    if (tasks.length === 0) return;
    const first = !!company && !hasPrepared(company);
    if (first) {
      let okCount = 0;
      await runTransfer({
        title: 'A preparar o aparelho para trabalhar sem internet',
        kind: 'download',
        file: 'Dados da empresa → memória do aparelho',
        task: async (ctl) => {
          okCount = await runAll(tasks, (d, t) => ctl.setPct((d / t) * 100, `${d} de ${t} áreas guardadas`));
        },
      });
      // Só marca como pronto se a maioria respondeu (senão volta a tentar no próximo arranque).
      if (okCount >= Math.ceil(tasks.length * 0.3)) markPrepared(company as string);
    } else {
      await runAll(tasks);
    }
  } finally {
    running = false;
    lastRunAt = Date.now();
  }
}

/** Atualização periódica silenciosa (10 min) enquanto a app está aberta e visível. */
/** Sobe as alterações feitas offline e, se subiu alguma, reconcilia a cópia local. */
let replaying = false;
export async function flushOutbox(company?: string | null): Promise<void> {
  if (!isNativeApp() || replaying) return;
  replaying = true;
  try {
    const n = await replayQueuedWrites();
    if (n > 0) { lastRunAt = 0; void prefetchTenantData(company); }
  } catch { /* tenta no próximo ciclo */ } finally { replaying = false; }
}

export function startPrefetchSchedule(company?: string | null): () => void {
  if (!isNativeApp() || typeof window === 'undefined') return () => undefined;
  window.clearInterval(timer);
  void flushOutbox(company);
  const flushTimer = window.setInterval(() => { void flushOutbox(company); }, 20_000);
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void prefetchTenantData(company);
  }, 10 * 60_000);
  const wake = () => { if (document.visibilityState === 'visible') { void flushOutbox(company); void prefetchTenantData(company); } };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  return () => { window.clearInterval(timer); window.clearInterval(flushTimer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
}
