/**
 * POLÍTICA DE REPLICAÇÃO — o que fazer quando o posto e a nuvem discordam.
 *
 * Este é o ficheiro mais perigoso do sistema. Um erro aqui não rebenta: escreve
 * silenciosamente a versão errada de um registo e só se descobre meses depois,
 * num relatório que não bate certo ou num inventário que não fecha. Por isso
 * está isolado, é puro (não toca em rede nem em base de dados) e é onde estão
 * os testes mais paranoicos do projeto.
 *
 * ## A ideia que manda em tudo
 *
 * Não há UMA política de conflitos. Há **classes de dados**, e cada uma tem a
 * sua — porque a natureza do dado é que decide o que é correto:
 *
 * | Classe | Exemplo | O que se faz | Porquê |
 * |---|---|---|---|
 * | `fiscal` | faturas, turnos | **união de inserções**, nunca alteração | Cada série tem UM só escritor (uma por posto). Dois postos não podem colidir — o conflito foi impedido lá atrás, na numeração. |
 * | `additive` | movimentos de stock | **soma**, todos entram | `-3` e `-5` somam-se em qualquer ordem e dão o mesmo. Sincronizar o SALDO (`40`) perderia uma das vendas. |
 * | `derived` | saldo de stock | **não se replica** | É calculado a partir dos movimentos. Replicá-lo seria replicar a conclusão em vez das premissas — e as duas versões nunca bateriam certo. |
 * | `catalog` | produtos, clientes | **última escrita ganha**, com registo | Um preço é um facto simples: o mais recente é o que vale. Mas o que perdeu **fica registado**. |
 * | `cloud` | utilizadores, planos | **a nuvem manda** | O posto lê, não escreve. Deixar um posto alterar quem tem acesso seria um buraco de segurança. |
 * | `device` | séries fiscais, contadores | **fica no posto** | A sequência de cada posto é dele. Sincronizá-la entre postos partiria a numeração de ambos. |
 *
 * ## O que NUNCA acontece
 *
 * Nada se perde em silêncio. Toda a decisão em que houve duas versões
 * diferentes produz um registo de conflito com as DUAS, mesmo quando a escolha
 * foi óbvia. Uma tabela que este ficheiro não conheça **não é replicada** e é
 * denunciada — porque adivinhar a classe errada é pior do que não sincronizar.
 */

export type DataClass = 'fiscal' | 'additive' | 'derived' | 'catalog' | 'cloud' | 'device' | 'unknown';

/**
 * Classificação explícita. Só entra aqui o que foi PENSADO — o resto cai em
 * `unknown` de propósito (ver o fim deste ficheiro).
 */
const CLASSES: Record<string, DataClass> = {
  // ── FISCAL: append-only, série por posto, nunca alterado ──
  invoices: 'fiscal',
  invoice_items: 'fiscal',
  cash_sessions: 'fiscal',
  cash_movements: 'fiscal',
  tenant_audit_log: 'fiscal',
  employee_consumptions: 'fiscal',
  loyalty_movements: 'fiscal',
  receivable_payments: 'fiscal',
  payable_payments: 'fiscal',
  payment_proofs: 'fiscal',

  // ── ADITIVO: somam-se, a ordem não importa ───────────────
  stock_movements: 'additive',

  // ── DERIVADO: calculado, nunca replicado ─────────────────
  // O saldo vem dos movimentos. Replicá-lo era replicar a conclusão em vez das
  // premissas — e bastava uma venda chegar fora de ordem para os dois lados
  // discordarem para sempre.
  stock_items: 'derived',

  // ── DO POSTO: a sequência de cada um é dele ──────────────
  // Sincronizar isto entre postos partia a numeração dos dois de uma só vez.
  fiscal_series: 'device',
  document_counters: 'device',
  devices: 'device',

  // ── DA NUVEM: o posto lê, não escreve ────────────────────
  users: 'cloud',              // quem tem acesso não se decide num posto
  fiscal_signing_keys: 'cloud', // chaves de assinatura nunca saem alteradas
  backups: 'cloud',

  // ── CATÁLOGO: última escrita ganha, com registo ──────────
  products: 'catalog',
  product_categories: 'catalog',
  product_recipes: 'catalog',
  product_batches: 'catalog',
  customers: 'catalog',
  suppliers: 'catalog',
  warehouses: 'catalog',
  stores: 'catalog',
  promotions: 'catalog',
  payment_methods: 'catalog',
  site_settings: 'catalog',
  site_pages: 'catalog',
  employees: 'catalog',
  loyalty_cards: 'catalog',
  expenses: 'catalog',
  receivables: 'catalog',
  payables: 'catalog',
  bank_transactions: 'catalog',
  purchase_orders: 'catalog',
  purchase_order_items: 'catalog',
  web_orders: 'catalog',
  web_order_items: 'catalog',
  order_messages: 'catalog',
  staff_messages: 'catalog',
  staff_chat_reads: 'catalog',
  customer_messages: 'catalog',
  ai_messages: 'catalog',
  salary_advances: 'catalog',
  payroll_runs: 'catalog',
  payroll_items: 'catalog',
  leave_requests: 'catalog',
  cameras: 'catalog',
  stock_counts: 'catalog',
  stock_count_items: 'catalog',
  restaurant_tables: 'catalog',
  restaurant_orders: 'catalog',
  restaurant_order_items: 'catalog',
  service_orders: 'catalog',
  service_equipments: 'catalog',
  service_order_items: 'catalog',
  hotel_rooms: 'catalog',
  hotel_housekeeping: 'catalog',
  hotel_maintenance: 'catalog',
  hotel_reservations: 'catalog',
  hotel_folio_items: 'catalog',
  clinic_patients: 'catalog',
  clinic_appointments: 'catalog',
  clinic_consultations: 'catalog',
  clinic_professionals: 'catalog',
  clinic_prescriptions: 'catalog',
  clinic_prescription_items: 'catalog',
  clinic_vitals: 'catalog',
  clinic_beds: 'catalog',
  clinic_admissions: 'catalog',
  clinic_triage: 'catalog',
  clinic_exams: 'catalog',
  clinic_insurers: 'catalog',
  clinic_insurer_claims: 'catalog',
};

/** A classe desta tabela. Desconhecida = não replicar (ver `isReplicated`). */
export function classify(table: string): DataClass {
  return CLASSES[table] ?? 'unknown';
}

/** Esta tabela viaja entre o posto e a nuvem? */
export function isReplicated(table: string): boolean {
  const c = classify(table);
  return c === 'fiscal' || c === 'additive' || c === 'catalog';
}

/** Tabelas que este ficheiro não conhece — para serem denunciadas, não adivinhadas. */
export function unknownTables(all: string[]): string[] {
  return all.filter((t) => classify(t) === 'unknown');
}

/** O que sabemos de uma versão de um registo. */
export interface Version {
  /** Identificador global da linha. */
  id: string;
  /** Contador que sobe a cada alteração (o mais fiável). */
  version?: number | null;
  /** Momento da última alteração (ISO). */
  updatedAt?: string | null;
  /** Posto que fez a alteração — só para desempate determinístico. */
  deviceId?: string | null;
  /** Foi apagado? */
  deleted?: boolean;
}

export type Winner = 'local' | 'remote' | 'both' | 'neither';

export interface Resolution {
  winner: Winner;
  /** Frase curta, em português, para o registo de auditoria. */
  reason: string;
  /** Houve DUAS versões diferentes? (então tem de ficar registado) */
  conflict: boolean;
}

/**
 * Decide entre a versão do posto e a da nuvem.
 *
 * `both` significa "ficam as duas" — é a resposta certa para o que é
 * append-only e para o que é aditivo, onde não existe tal coisa como escolher.
 */
export function resolve(table: string, local: Version | null, remote: Version | null): Resolution {
  const c = classify(table);

  if (c === 'unknown') {
    return { winner: 'neither', reason: `tabela não classificada (${table}) — não replicada`, conflict: false };
  }
  if (c === 'derived') {
    return { winner: 'neither', reason: 'valor derivado — recalculado a partir dos movimentos', conflict: false };
  }
  if (c === 'device') {
    return { winner: 'local', reason: 'sequência deste posto — não viaja', conflict: false };
  }
  if (c === 'cloud') {
    return { winner: 'remote', reason: 'decidido na nuvem — o posto só lê', conflict: false };
  }

  if (!local && !remote) return { winner: 'neither', reason: 'não existe em lado nenhum', conflict: false };
  if (!local) return { winner: 'remote', reason: 'só existe na nuvem', conflict: false };
  if (!remote) return { winner: 'local', reason: 'só existe no posto', conflict: false };

  if (c === 'fiscal' || c === 'additive') {
    // Aqui não há escolha a fazer, e é isso que torna estas classes seguras.
    // Se as duas versões do MESMO id divergirem, não é um conflito para
    // resolver — é um sintoma de que a numeração por posto foi violada, e tem
    // de ser gritado, não remendado.
    const divergem = differs(local, remote);
    return {
      winner: 'both',
      reason: divergem
        ? 'ATENÇÃO: duas versões do mesmo registo append-only — a série por posto foi violada'
        : (c === 'fiscal' ? 'registo fiscal — união de inserções' : 'movimento aditivo — todos entram'),
      conflict: divergem,
    };
  }

  // ── CATÁLOGO: última escrita ganha ────────────────────────
  // Por esta ordem, e a ordem importa:
  //  1. `version` — um contador é inequívoco e não depende de relógios;
  //  2. `updatedAt` — relógios de máquinas diferentes divergem, mas é o que há;
  //  3. `deviceId` — só para que o resultado seja SEMPRE o mesmo dos dois lados.
  //     Sem este terceiro critério, o posto e a nuvem podiam escolher vencedores
  //     diferentes e ficar a trocar de versão para sempre.
  const conflict = differs(local, remote);

  const lv = local.version ?? null;
  const rv = remote.version ?? null;
  if (lv !== null && rv !== null && lv !== rv) {
    return {
      winner: lv > rv ? 'local' : 'remote',
      reason: `versão mais alta (${Math.max(lv, rv)} sobre ${Math.min(lv, rv)})`,
      conflict,
    };
  }

  const lt = Date.parse(local.updatedAt ?? '');
  const rt = Date.parse(remote.updatedAt ?? '');
  const lok = !Number.isNaN(lt);
  const rok = !Number.isNaN(rt);
  if (lok && rok && lt !== rt) {
    return {
      winner: lt > rt ? 'local' : 'remote',
      reason: 'alteração mais recente',
      conflict,
    };
  }
  if (lok !== rok) {
    return { winner: lok ? 'local' : 'remote', reason: 'só um dos lados tem data de alteração', conflict };
  }

  // Empate a sério. Desempate ESTÁVEL — o critério não interessa, interessa que
  // os dois lados cheguem à mesma conclusão sem falar um com o outro.
  const ld = local.deviceId ?? '';
  const rd = remote.deviceId ?? '';
  if (ld !== rd) {
    return { winner: ld > rd ? 'local' : 'remote', reason: 'empate desfeito pelo posto de origem', conflict };
  }
  return { winner: 'remote', reason: 'versões equivalentes', conflict: false };
}

/** As duas versões são realmente diferentes? */
function differs(a: Version, b: Version): boolean {
  return (a.version ?? null) !== (b.version ?? null)
    || (a.updatedAt ?? null) !== (b.updatedAt ?? null)
    || (a.deleted ?? false) !== (b.deleted ?? false);
}
