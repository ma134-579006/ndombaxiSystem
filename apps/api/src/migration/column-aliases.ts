/**
 * Dicionário de aliases de colunas — mapeamento 100% DETERMINÍSTICO (nunca
 * "adivinha" com IA) dos cabeçalhos comuns em exportações de sistemas usados
 * em Angola (Vendus, Primavera, PHC/"Negócio" e exportações genéricas Excel).
 * Cada campo canónico tem uma lista de variantes conhecidas; o cabeçalho do
 * ficheiro é normalizado (sem acentos/maiúsculas/pontuação) e comparado.
 */
export type ProductField = 'barcode' | 'code' | 'name' | 'category' | 'stock' | 'costPrice' | 'salePrice' | 'profit';
export type CustomerField = 'name' | 'taxId' | 'phone' | 'email' | 'address' | 'debt' | 'history';
export type SupplierField = 'name' | 'taxId' | 'phone' | 'email' | 'address' | 'debt' | 'history';

export const PRODUCT_ALIASES: Record<ProductField, string[]> = {
  barcode: ['codigo de barras', 'codigo barras', 'cod barras', 'cod de barras', 'ean', 'ean13', 'ean 13', 'codigo ean', 'barcode', 'gtin'],
  code: ['codigo', 'cod', 'referencia', 'ref', 'sku', 'codigo interno', 'codigo produto', 'cod produto', 'codigo artigo'],
  name: ['nome do produto', 'nome produto', 'designacao', 'designacao do artigo', 'descricao', 'descricao do produto', 'artigo', 'produto', 'nome'],
  category: ['categoria', 'familia', 'grupo', 'seccao'],
  stock: ['stock', 'stock atual', 'quantidade', 'qtd', 'qtd stock', 'existencias', 'stock disponivel', 'saldo stock', 'quantidade em stock'],
  costPrice: ['valor unitario', 'custo unitario', 'preco custo', 'preco de custo', 'custo', 'p custo', 'preco compra', 'valor de custo', 'preco de compra'],
  salePrice: ['valor de venda', 'preco de venda', 'preco venda', 'pvp', 'p v p', 'valor venda', 'preco unitario venda', 'preco unitario de venda'],
  profit: ['lucro', 'margem', 'lucro unitario', 'margem de lucro', 'margem lucro'],
};

export const CUSTOMER_ALIASES: Record<CustomerField, string[]> = {
  name: ['nome', 'nome do cliente', 'cliente', 'designacao', 'razao social', 'nome cliente'],
  taxId: ['nif', 'bi', 'bilhete de identidade', 'contribuinte', 'n contribuinte', 'numero contribuinte', 'n nif', 'nif bi', 'nif ou bi'],
  phone: ['telefone', 'contacto', 'telemovel', 'n telefone', 'numero de telefone'],
  email: ['email', 'e mail', 'correio eletronico'],
  address: ['morada', 'endereco', 'residencia', 'endereco completo'],
  debt: ['saldo', 'divida', 'saldo devedor', 'conta a pagar', 'valor em divida', 'saldo em aberto', 'divida atual', 'valor devido'],
  history: ['historico', 'observacoes', 'notas', 'obs', 'observacao'],
};

export const SUPPLIER_ALIASES: Record<SupplierField, string[]> = {
  name: ['nome', 'nome do fornecedor', 'fornecedor', 'designacao', 'razao social', 'nome fornecedor'],
  taxId: ['nif', 'contribuinte', 'n contribuinte', 'numero contribuinte'],
  phone: ['telefone', 'contacto', 'telemovel'],
  email: ['email', 'e mail'],
  address: ['morada', 'endereco'],
  debt: ['saldo', 'divida', 'saldo devedor', 'conta a pagar', 'valor em divida', 'saldo em aberto', 'divida atual', 'valor devido'],
  history: ['historico', 'observacoes', 'notas', 'obs'],
};

/** Remove acentos, baixa para minúsculas e normaliza espaços/pontuação. */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Mapeia os cabeçalhos do ficheiro para os campos canónicos. 1ª passagem:
 * igualdade exacta (após normalizar). 2ª passagem: o cabeçalho CONTÉM uma
 * variante conhecida (cobre cabeçalhos como "Código de Barras (EAN)"). Nunca
 * inventa uma correspondência fora do dicionário — puramente determinístico.
 */
export function mapHeaders<F extends string>(
  headers: string[],
  aliases: Record<F, string[]>,
): { mapping: Partial<Record<F, string>>; unmapped: string[] } {
  const normalized = headers.map((h) => ({ original: h, norm: normalizeHeader(h) }));
  const mapping: Partial<Record<F, string>> = {};
  const fields = Object.keys(aliases) as F[];

  for (const field of fields) {
    const variants = aliases[field];
    // 1ª passagem: igualdade exacta.
    const exact = normalized.find((h) => variants.includes(h.norm));
    if (exact) { mapping[field] = exact.original; continue; }
    // 2ª passagem: contém a variante como substring.
    const partial = normalized.find((h) => variants.some((v) => h.norm.includes(v)));
    if (partial) mapping[field] = partial.original;
  }

  const mappedOriginals = new Set(Object.values(mapping));
  const unmapped = headers.filter((h) => !mappedOriginals.has(h));
  return { mapping, unmapped };
}

/**
 * Interpreta um número escrito em qualquer formato comum (PT: "1.234,56";
 * EN: "1,234.56"; simples: "1234.56"/"1234,56") — nunca "adivinha" fora destas
 * regras determinísticas; valores inválidos devolvem 0 (nunca lança excepção,
 * a linha é assinalada no preview em vez de partir a importação toda).
 */
export function parseFlexibleNumber(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  let s = String(raw).trim().replace(/[^\d.,-]/g, ''); // tira Kz/AOA/€/$/espaços
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // O separador que aparece por último é o decimal; o outro é de milhares.
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // só ponto: assume já ser separador decimal (formato JS-nativo).
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
