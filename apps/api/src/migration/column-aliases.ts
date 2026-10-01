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
  barcode: ['codigo de barras', 'codigos de barras', 'codigo de barra', 'codigo barras', 'codigo barra', 'cod barras', 'cod barra', 'cod de barras', 'cod de barra', 'codbarras', 'codbarra', 'c barras', 'barras', 'barra', 'ean', 'ean13', 'ean 13', 'ean8', 'ean 8', 'codigo ean', 'cod ean', 'upc', 'barcode', 'bar code', 'gtin', 'cb'],
  code: ['codigo', 'cod', 'referencia', 'ref', 'sku', 'codigo interno', 'cod interno', 'codigo produto', 'cod produto', 'codigo artigo', 'cod artigo', 'codigo do produto', 'codigo do artigo', 'id produto', 'id artigo', 'n artigo', 'numero artigo', 'item', 'item code', 'referencia interna', 'id'],
  name: ['nome do produto', 'nome produto', 'nome do artigo', 'nome artigo', 'designacao', 'designacao do artigo', 'designacao produto', 'descricao', 'descricao do produto', 'descricao artigo', 'descricao do artigo', 'artigo', 'produto', 'nome', 'item name', 'product name', 'description'],
  category: ['categoria', 'categorias', 'familia', 'grupo', 'seccao', 'departamento', 'classe', 'category'],
  stock: ['stock', 'stock atual', 'stock actual', 'stock disponivel', 'stock final', 'stock total', 'stock existente', 'quantidade', 'quantidade em stock', 'quantidade atual', 'quantidade existente', 'quant', 'qtd', 'qtd stock', 'qtd atual', 'qtd existente', 'qtde', 'qty', 'quantity', 'existencias', 'existencia', 'saldo', 'saldo stock', 'saldo atual', 'em stock', 'unidades', 'inventario', 'contagem', 'disponivel'],
  costPrice: ['preco fornecedor', 'preco do fornecedor', 'preco de fornecedor', 'custo fornecedor', 'valor unitario', 'custo unitario', 'custo unit', 'preco custo', 'preco de custo', 'preco custo unitario', 'custo', 'custo medio', 'custo de compra', 'p custo', 'pcusto', 'preco compra', 'preco de compra', 'preco de aquisicao', 'aquisicao', 'valor de custo', 'valor compra', 'cost', 'cost price'],
  salePrice: ['valor de venda', 'valor venda', 'preco de venda', 'preco venda', 'preco venda unitario', 'preco unitario venda', 'preco unitario de venda', 'pvp', 'p v p', 'preco publico', 'preco ao publico', 'preco final', 'preco com iva', 'preco', 'sale price', 'price'],
  profit: ['lucro', 'margem', 'lucro unitario', 'margem de lucro', 'margem lucro'],
};

/** Palavras que DESQUALIFICAM uma coluna para um campo (ex.: «Stock mínimo» não é o stock). */
export const PRODUCT_NEGATIVE: Partial<Record<ProductField, string[]>> = {
  stock: ['controlar', 'controlo', 'controla', 'gerir', 'gestao', 'minimo', 'minima', 'maximo', 'maxima', 'seguranca', 'reposicao', 'encomenda', 'preco', 'valor', 'custo', 'iva', 'anterior', 'reservado', 'reserva'],
  code: ['barras', 'barra', 'ean', 'fornecedor', 'categoria', 'familia', 'iva', 'postal', 'cliente'],
  name: ['fornecedor', 'categoria', 'familia', 'cliente', 'codigo'],
  category: ['codigo', 'cod', 'id'],
  costPrice: ['total', 'iva', 'venda', 'pvp'],
  salePrice: ['custo', 'compra', 'total', 'aquisicao', 'cost', 'fornecedor'],
};

/** Ordem de atribuição: os campos mais específicos primeiro (evita que «Código» roube a coluna de barras). */
export const PRODUCT_FIELD_ORDER: ProductField[] = ['barcode', 'stock', 'costPrice', 'salePrice', 'profit', 'code', 'category', 'name'];

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

const tokensOf = (norm: string): string[] => norm.split(' ').filter(Boolean);

/** As palavras de `needle` aparecem, seguidas e INTEIRAS, em `hay`? (nunca por pedaços de palavra) */
function containsWords(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/**
 * Mapeia os cabeçalhos do ficheiro para os campos canónicos — determinístico.
 *  1) igualdade exacta (após normalizar);
 *  2) o cabeçalho CONTÉM a variante como palavras INTEIRAS («Código de Barras (EAN)»
 *     contém «codigo de barras»; «Descodificação» NÃO contém «cod»);
 *  3) uma coluna serve UM só campo; palavras de `negative` desqualificam («Stock
 *     mínimo» nunca é o stock). Os campos são atribuídos por `order`.
 * Nunca inventa uma correspondência fora do dicionário.
 */
export function mapHeaders<F extends string>(
  headers: string[],
  aliases: Record<F, string[]>,
  opts: { negative?: Partial<Record<F, string[]>>; order?: F[] } = {},
): { mapping: Partial<Record<F, string>>; unmapped: string[] } {
  const normalized = headers.map((h) => {
    const norm = normalizeHeader(h);
    return { original: h, norm, tokens: tokensOf(norm) };
  });
  const mapping: Partial<Record<F, string>> = {};
  const used = new Set<string>();
  const fields = opts.order ?? (Object.keys(aliases) as F[]);

  for (const field of fields) {
    const variants = aliases[field] ?? [];
    const neg = opts.negative?.[field] ?? [];
    const eligible = normalized.filter((h) => !used.has(h.original) && !neg.some((n) => h.tokens.includes(n)));
    // 1ª passagem: igualdade exacta.
    let pick = eligible.find((h) => variants.includes(h.norm));
    // 2ª passagem: contém a variante (palavras inteiras) — a variante mais longa ganha.
    if (!pick) {
      let best = 0;
      for (const h of eligible) {
        for (const v of variants) {
          const vt = tokensOf(v);
          if (vt.length > best && containsWords(h.tokens, vt)) { best = vt.length; pick = h; }
        }
      }
    }
    if (pick) { mapping[field] = pick.original; used.add(pick.original); }
  }

  const unmapped = headers.filter((h) => !used.has(h));
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
