/**
 * Relatórios no menu lateral (como no Vendus: Gestão › Relatórios › Produtos,
 * Clientes, Marcas…). Ficheiro à parte para o menu não carregar a página inteira.
 */
export type ReportTab = 'all' | 'product' | 'user' | 'store' | 'category' | 'brand' | 'evolution' | 'tax' | 'payments' | 'documents' | 'cashbox' | 'customer' | 'hour' | 'weekday' | 'daily' | 'month';

/** Mesma ordem do menu «Relatórios» do Vendus; no fim, os da contabilidade. */
export const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: 'cashbox', label: 'Movimentos de Caixa' },
  { key: 'product', label: 'Produtos' },
  { key: 'customer', label: 'Clientes' },
  { key: 'brand', label: 'Marcas' },
  { key: 'category', label: 'Categorias' },
  { key: 'store', label: 'Lojas' },
  { key: 'user', label: 'Utilizadores' },
  { key: 'daily', label: 'Diário' },
  { key: 'hour', label: 'Por Hora' },
  { key: 'weekday', label: 'Dias da Semana' },
  { key: 'month', label: 'Mensal' },
  { key: 'evolution', label: 'Evolução' },
  { key: 'payments', label: 'Métodos de Pagamento' },
  { key: 'documents', label: 'Listagem de Documentos' },
  { key: 'tax', label: 'Mapa de Impostos' },
];

/** Chave da secção no menu: «reports» continua a abrir o relatório de Produtos. */
export const reportSectionKey = (t: ReportTab) => (t === 'product' ? 'reports' : `rp-${t}`);
export const isReportSection = (s: string) => s === 'reports' || s.startsWith('rp-');
export const reportTabFor = (s: string): ReportTab => (s === 'reports' ? 'product' : (s.slice(3) as ReportTab));
