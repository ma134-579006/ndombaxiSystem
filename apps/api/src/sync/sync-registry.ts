/**
 * Registo das entidades que descem para os postos offline.
 *
 * Uma entidade só entra aqui se cumprir três condições:
 *   1. É preciso tê-la para trabalhar sem internet (catálogo, clientes, preços).
 *   2. Tem `updated_at` — sem isso não há sincronização incremental possível.
 *   3. Não contém segredos que não devam ficar no disco de um posto de venda.
 *
 * Note-se o que NÃO está aqui, de propósito: faturas, movimentos de caixa e
 * folhas salariais. Esses documentos SOBEM do posto, mas não descem em massa —
 * um portátil roubado não pode levar o histórico fiscal da empresa consigo.
 */

export interface SyncEntityDef {
  /** Nome da entidade no protocolo (o mesmo que o cliente usa). */
  entity: string;
  /** Tabela no schema do tenant. */
  table: string;
  /** Colunas a enviar. Lista explícita — nunca `SELECT *`, para não vazar colunas
   *  novas sem alguém ter decidido que podem sair do servidor. */
  columns: string[];
  /** Coluna de marca temporal usada como cursor. */
  updatedAt: string;
  /** Coluna booleana de soft-delete, se existir. `false` vira lápide no cliente. */
  activeFlag?: string;
  /** Papel mínimo para receber esta entidade. */
  minRole: 'CASHIER' | 'STORE_MANAGER';
}

export const SYNC_ENTITIES: Record<string, SyncEntityDef> = {
  product: {
    entity: 'product',
    table: 'products',
    columns: [
      'id', 'code', 'barcode', 'name', 'description', 'category_id', 'brand',
      'iva_code', 'exemption_reason', 'exemption_code', 'unit_price', 'stock_qty',
      'shared_stock', 'image_url', 'show_online', 'is_ingredient', 'is_production',
      'unit', 'active_ingredient', 'requires_prescription', 'is_active',
      'created_at', 'updated_at',
    ],
    // `cost_price` fica de fora: a margem da empresa não desce para o balcão.
    updatedAt: 'updated_at',
    activeFlag: 'is_active',
    minRole: 'CASHIER',
  },

  category: {
    entity: 'category',
    table: 'product_categories',
    columns: ['id', 'name', 'parent_id', 'is_active', 'created_at', 'updated_at'],
    updatedAt: 'updated_at',
    activeFlag: 'is_active',
    minRole: 'CASHIER',
  },

  customer: {
    entity: 'customer',
    table: 'customers',
    columns: [
      'id', 'tax_id', 'name', 'email', 'phone', 'address',
      'province', 'municipality', 'neighborhood', 'is_active',
      'created_at', 'updated_at',
    ],
    updatedAt: 'updated_at',
    activeFlag: 'is_active',
    minRole: 'CASHIER',
  },

  promotion: {
    entity: 'promotion',
    table: 'promotions',
    columns: [
      'id', 'name', 'type', 'scope', 'target_id', 'percent', 'amount',
      'buy_qty', 'pay_qty', 'min_qty', 'tier_percent', 'priority', 'is_active',
      'starts_at', 'ends_at', 'weekdays', 'start_time', 'end_time',
      'created_at', 'updated_at',
    ],
    updatedAt: 'updated_at',
    activeFlag: 'is_active',
    minRole: 'CASHIER',
  },

  store: {
    entity: 'store',
    table: 'stores',
    columns: ['id', 'code', 'name', 'address', 'is_default', 'is_active', 'created_at', 'updated_at'],
    updatedAt: 'updated_at',
    activeFlag: 'is_active',
    minRole: 'CASHIER',
  },

  paymentMethod: {
    entity: 'paymentMethod',
    table: 'payment_methods',
    columns: [
      'id', 'type', 'label', 'instructions', 'bank_name', 'iban', 'account_holder',
      'reference_entity', 'reference_number', 'express_phone', 'sort_order',
      'is_active', 'created_at', 'updated_at',
    ],
    // `callback_secret` NUNCA sai daqui: é o segredo com que a EMIS confirma
    // pagamentos. Num disco de um posto de venda, seria a chave para forjar
    // confirmações de pagamento. É por isto que listamos colunas à mão em vez
    // de fazer `SELECT *` — uma coluna sensível nova nunca escapa por descuido.
    updatedAt: 'updated_at',
    activeFlag: 'is_active',
    minRole: 'CASHIER',
  },
};

/** Entidades permitidas a quem só tem o papel de caixa. */
export function allowedEntities(isManager: boolean): string[] {
  return Object.values(SYNC_ENTITIES)
    .filter((d) => isManager || d.minRole === 'CASHIER')
    .map((d) => d.entity);
}

/**
 * Valida um nome de entidade vindo do cliente contra o registo.
 * Nunca interpolamos nomes de tabela vindos do pedido — só os que estão aqui.
 */
export function resolveEntity(name: string): SyncEntityDef | null {
  return Object.prototype.hasOwnProperty.call(SYNC_ENTITIES, name)
    ? SYNC_ENTITIES[name]
    : null;
}
