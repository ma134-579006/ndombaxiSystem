/**
 * Tipos partilhados do motor Offline-First do Ndombaxi System.
 *
 * Princípio de ouro: o cliente NUNCA inventa identidade fiscal. Números de
 * documento, hash AGT e sequências são sempre atribuídos pelo servidor. O que o
 * cliente garante é que a operação **acontece uma única vez** (opId) e que
 * **nunca se perde** (outbox durável).
 */

// ── Outbox (fila de mutações) ────────────────────────────────

/** Estado de uma operação na fila de saída. */
export type OutboxStatus =
  /** À espera de janela de rede. É o estado normal offline. */
  | 'PENDING'
  /** Entregue ao servidor neste instante (evita envio duplo concorrente). */
  | 'INFLIGHT'
  /** O servidor recusou por razão de negócio (4xx). Exige revisão humana. */
  | 'BLOCKED'
  /** Confirmada pelo servidor. Mantida por um tempo para auditoria. */
  | 'DONE';

/**
 * Uma mutação local à espera de subir. É a unidade indivisível de durabilidade:
 * enquanto existir aqui, o trabalho do utilizador está seguro.
 */
export interface OutboxOp<P = unknown> {
  /** UUID v4 gerado no cliente. É a chave de idempotência ponta-a-ponta. */
  opId: string;
  /** Ordem de criação local, monotónica. Preserva causalidade no envio. */
  seq: number;
  /** Entidade de domínio (ex.: 'sale', 'customer', 'product', 'stockMove'). */
  entity: string;
  /** Tipo de mutação. */
  op: 'create' | 'update' | 'delete';
  /** Identificador local do registo (uuid). Mapeado ao id do servidor no push. */
  localId: string;
  /** Corpo da mutação, já normalizado para o formato que a API espera. */
  payload: P;
  /**
   * Versão da entidade em que o utilizador se baseou ao editar. É isto que
   * permite detetar conflitos em vez de sobrescrever cegamente.
   */
  baseVersion: number | null;
  /** ISO. Instante real da ação do utilizador — não o do envio. */
  createdAt: string;
  /** Tentativas de entrega já feitas. Alimenta o backoff exponencial. */
  attempts: number;
  /** Epoch ms. Antes disto não se tenta de novo (backoff). */
  nextAttemptAt: number;
  status: OutboxStatus;
  /** Última falha legível, para o painel de diagnóstico. */
  lastError?: string;
  /** Código de erro do servidor, quando aplicável. */
  lastErrorCode?: string;
}

// ── Cache de leitura (read model) ────────────────────────────

/**
 * Um registo replicado do servidor. `version` e `updatedAt` são o que torna a
 * sincronização incremental possível: só desce o que mudou depois do cursor.
 */
export interface CachedEntity<T = unknown> {
  entity: string;
  /** id do servidor, ou o localId enquanto a criação não subiu. */
  id: string;
  data: T;
  version: number;
  /** ISO do servidor. */
  updatedAt: string;
  /** Apagado logicamente (tombstone) — nunca removemos à força do servidor. */
  deleted: boolean;
  /**
   * Escrito localmente e ainda não confirmado. A UI mostra estes registos de
   * imediato (optimistic) e marca-os como "por sincronizar".
   */
  dirty: boolean;
}

// ── Protocolo de sincronização ───────────────────────────────

/** Pedido de descida incremental. */
export interface PullRequest {
  /** Cursor opaco devolvido pelo servidor na descida anterior. */
  since: string | null;
  /** Entidades a sincronizar. Vazio = todas as permitidas ao utilizador. */
  entities: string[];
  /** Teto de registos por página. */
  limit: number;
}

export interface PullChange<T = unknown> {
  entity: string;
  id: string;
  data: T | null;
  version: number;
  updatedAt: string;
  deleted: boolean;
}

export interface PullResponse {
  changes: PullChange[];
  /** Cursor a usar na próxima descida. */
  cursor: string;
  /** true se ficou mais para trazer — o motor volta a puxar de imediato. */
  hasMore: boolean;
  /** Relógio do servidor (ISO). Usado para medir a deriva do relógio local. */
  serverTime: string;
}

/** Resultado por operação enviada. */
export interface PushResult {
  opId: string;
  status:
    /** Aplicada agora. */
    | 'applied'
    /** Já tinha sido aplicada antes (idempotência a funcionar). */
    | 'duplicate'
    /** Recusada por regra de negócio — não repetir. */
    | 'rejected'
    /** Conflito de versão — o motor decide pela política da entidade. */
    | 'conflict';
  /** id atribuído pelo servidor (create). */
  serverId?: string;
  /** Estado canónico após aplicar — evita uma descida extra. */
  entity?: PullChange;
  message?: string;
  code?: string;
}

export interface PushResponse {
  results: PushResult[];
  serverTime: string;
}

// ── Estado observável pela UI ────────────────────────────────

export type LinkState =
  /** Sem rede de todo. */
  | 'OFFLINE'
  /** Rede presente mas o servidor não responde (API a dormir, DNS, captive portal). */
  | 'SERVER_DOWN'
  /** Servidor a responder. */
  | 'ONLINE';

export interface SyncStatus {
  link: LinkState;
  /** Operações à espera de subir. */
  pending: number;
  /** Operações que precisam de decisão humana. */
  blocked: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Deriva estimada entre o relógio local e o do servidor, em ms. */
  clockSkewMs: number;
}

// ── Registo de auditoria da sincronização ────────────────────

export interface SyncLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  detail?: string;
}

// ── Sessão offline ───────────────────────────────────────────

/**
 * Credencial verificável sem rede. Guardamos apenas um derivado PBKDF2 do
 * segredo (PIN/senha) — nunca o segredo. Permite abrir o sistema com o mesmo
 * PIN de sempre, mesmo com semanas sem internet.
 */
export interface OfflineCredential {
  userId: string;
  companyCode: string;
  /** Rótulo para o ecrã de escolha de operador. */
  displayName: string;
  /** Base64 do salt aleatório de 16 bytes. */
  salt: string;
  /** Base64 do derivado PBKDF2-SHA256. */
  verifier: string;
  iterations: number;
  /** Permissões em cache, para o RBAC funcionar offline. */
  roles: string[];
  permissions: string[];
  /** ISO. Depois disto exige-se uma revalidação online. */
  validUntil: string;
  /** Último instante em que o servidor confirmou esta credencial. */
  refreshedAt: string;
}
