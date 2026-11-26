/** Os 6 relatórios do grupo «Contabilidade» do Vendus (Gestão › Contabilidade).
 *  À parte da página para o menu não carregar o código dos relatórios no arranque. */
export type AccTab = 'acc-documents' | 'acc-taxmap' | 'acc-products' | 'acc-daily' | 'acc-payments' | 'acc-suppliers';
export const ACC_TABS: { key: AccTab; label: string }[] = [
  { key: 'acc-documents', label: 'Listagem de Documentos' },
  { key: 'acc-taxmap', label: 'Mapa de Impostos' },
  { key: 'acc-products', label: 'Listagem Produtos' },
  { key: 'acc-daily', label: 'Vendas Diárias' },
  { key: 'acc-payments', label: 'Tipos Pagamento' },
  { key: 'acc-suppliers', label: 'Mapa de Impostos Fornecedores' },
];
export const isAccTab = (s: string): s is AccTab => ACC_TABS.some((t) => t.key === s);
