/**
 * Descarrega TODOS os dados principais da empresa para a cache offline logo após
 * o login do gestor — e outra vez sempre que a rede regressa.
 *
 * PORQUÊ: a read-through cache do cliente só guarda o que o utilizador VISITA.
 * O pedido é "assim que detectar login... fazer download de todos os dados
 * atualizados da empresa para armazenar localmente", para a Gestão ficar 100%
 * navegável sem rede desde o primeiro instante. Aqui tocamos uma vez em cada
 * leitura de referência: como passam pelo `request` do cliente, ficam gravadas na
 * cache partilhada (a mesma que a Caixa lê no Android, mesma origem).
 *
 * SEGURO E ADITIVO: são só LEITURAS (GET). Nada de escrita, nada de sincronização
 * bidirecional de documentos fiscais (isso exige um caminho próprio por
 * funcionalidade — ver a nota no fim). Best-effort: cada falha é ignorada e nunca
 * quebra a app; corre em segundo plano sem bloquear o ecrã.
 */
import { api } from '../api/client';

let running = false;
let lastRunAt = 0;

/** Dispara todas as leituras de referência em paralelo (best-effort). */
export async function prefetchTenantData(): Promise<void> {
  // Sem rede não há o que descarregar; a cache existente serve o offline.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  // Evita correr em paralelo consigo mesmo e repetir em rajada (ex.: vários
  // eventos 'online' seguidos). 30 s chega para não duplicar sem ficar obsoleto.
  if (running || Date.now() - lastRunAt < 30_000) return;
  running = true;

  // Curadoria dos dados que tornam a Gestão utilizável offline: catálogo,
  // clientes, marca/identidade, promoções, alertas, lojas/utilizadores, RH,
  // compras/armazéns e o resumo do painel. Cada um cai na cache ao responder.
  const tasks: Array<Promise<unknown>> = [
    api.products.list(),
    api.products.ingredients(),
    api.customers.list(),
    api.branding(),
    api.promotions.list(),
    api.alerts(),
    api.site.get(),
    api.firstSteps(),
    api.staff.listStores(),
    api.staff.listUsers(),
    api.hr.employees(),
    api.purchasing.listSuppliers(),
    api.purchasing.warehouses(),
    api.dashboard.salesToday(),
    api.dashboard.topProducts(),
    api.dashboard.lowStock(),
    api.orders.list(),
    api.orders.pendingCount(),
  ];

  try {
    await Promise.allSettled(tasks);
  } finally {
    running = false;
    lastRunAt = Date.now();
  }
}
