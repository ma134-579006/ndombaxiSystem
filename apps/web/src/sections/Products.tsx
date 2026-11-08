import { confirmDialog, runBulk, toast, readFileProgress } from '../components/feedback';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CreateProductInput, IvaCode, ManagerProduct, WarehouseRow } from '../api/types';
import { IVA_RATE } from '../api/types';
import { IconChevronDown, IconEdit, IconImage, IconPlus, IconSearch, IconTruck } from '../components/Icons';
import { takeQuickCreate } from '../components/TopStatus';
import { Modal, Switch } from '../components/ui';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { StockEntryModal } from './Inventory';
import { formatKz } from '../format';
import { pollEvery, stopPoll } from '../poll';
import { TAX_EXEMPTIONS } from '../exemptions';

const IVA_OPTIONS: IvaCode[] = ['NOR', 'INT', 'RED', 'ISE', 'OUT'];
type SortKey = 'code' | 'name' | 'price' | 'cost' | 'iva' | 'stock';
/** Colunas visíveis da listagem (preferência deste aparelho). */
const COLS_KEY = 'nx:products:cols';

function grossUnit(p: ManagerProduct): number {
  return Number(p.unit_price) * (1 + IVA_RATE[p.iva_code] / 100);
}

interface FormState {
  code: string;
  barcode: string;
  name: string;
  description: string;
  brand: string;
  ivaCode: IvaCode | 'AUTO';
  /** Código de isenção AGT (M..) — obrigatório para IVA isento. */
  exemptionCode: string;
  unitPrice: string;
  costPrice: string;
  stockQty: string;
  purchaseTotal: string;
  categoryId: string;
  storeIds: string[];
  allStores: boolean;
  sharedStock: boolean;
  imageUrl: string;
  showOnline: boolean;
  isActive: boolean;
  isIngredient: boolean;
  isProduction: boolean;
  unit: string;
  requiresPrescription: boolean;
}

const EMPTY: FormState = {
  code: '',
  barcode: '',
  name: '',
  description: '',
  brand: '',
  ivaCode: 'AUTO',
  exemptionCode: '',
  unitPrice: '',
  costPrice: '',
  stockQty: '0',
  purchaseTotal: '',
  categoryId: '',
  storeIds: [],
  allStores: true,
  sharedStock: false,
  imageUrl: '',
  showOnline: true,
  isActive: true,
  isIngredient: false,
  isProduction: false,
  unit: '',
  requiresPrescription: false,
};

/** Unidades de medida comuns (informativas — sem conversão automática). */
const UNIT_OPTIONS = ['un', 'kg', 'g', 'L', 'ml', 'fatia', 'folha', 'dose', 'porção', 'caixa', 'pacote', 'garrafa', 'lata'];

/** Iniciais do produto (sem foto): 2 letras das primeiras palavras com letras. */
function monoOf(name: string): string {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => /\p{L}/u.test(x));
  if (!w.length) return (name.trim()[0] ?? '?').toUpperCase();
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}
const MONO = ['#2430E8', '#4338CA', '#0E7490', '#0F766E', '#6D28D9', '#BE185D', '#B45309', '#334155'];
function monoColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONO[h % MONO.length];
}

export function Products() {
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [stores, setStores] = useState<WarehouseRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCategory, setNewCategory] = useState('');
  // IVA padrão da empresa — para o PVP mostrar o preço final também em "Automático".
  const [companyIva, setCompanyIva] = useState<string | null>(null);
  useEffect(() => { api.site.get().then((st) => setCompanyIva(st.default_iva_code || null)).catch(() => undefined); }, []);
  const [search, setSearch] = useState('');
  // CATÁLOGOS GRANDES: páginas de 100 e pesquisa no SERVIDOR (ou na memória
  // interna, sem rede) — nunca o catálogo inteiro de uma vez.
  const PAGE = 100;
  const [pages, setPages] = useState(1);
  const queryRef = useRef({ q: '', pages: 1 });
  queryRef.current = { q: search.trim(), pages };
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ManagerProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.products.stats>> | null>(null);
  const isExempt = form.ivaCode === 'ISE' || form.ivaCode === 'OUT';
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pfilter, setPfilter] = useState<'ALL' | 'IN' | 'OUT' | 'ONLINE' | 'OFF'>('ALL');
  const [busy, setBusy] = useState(false);
  const [enterFor, setEnterFor] = useState<string | undefined>(undefined);
  const [entering, setEntering] = useState(false);
  const [producing, setProducing] = useState(false);
  // Filtros, colunas, ordenação e paginação da listagem.
  const [fCat, setFCat] = useState('');
  const [fType, setFType] = useState<'ALL' | 'PRODUCT' | 'INGREDIENT' | 'PRODUCTION'>('ALL');
  const [fOnline, setFOnline] = useState<'ALL' | 'ON' | 'OFF'>('ALL');
  const [fPvpMin, setFPvpMin] = useState('');
  const [fPvpMax, setFPvpMax] = useState('');
  const [fCostMin, setFCostMin] = useState('');
  const [fCostMax, setFCostMax] = useState('');
  const [cols, setCols] = useState(() => {
    const def = { code: true, price: true, cost: true, iva: true, stock: true, cat: false };
    try { return { ...def, ...JSON.parse(localStorage.getItem(COLS_KEY) || '{}') } as typeof def; } catch { return def; }
  });
  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch { /* ignora */ } }, [cols]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [headMenu, setHeadMenu] = useState<'add' | 'more' | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const headMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  // Fecha os menus (cabeçalho e "Opções" da linha) ao clicar fora ou com Esc.
  useEffect(() => {
    if (!headMenu && !rowMenu) return;
    const inside = (t: Node) => [headMenuRef, moreMenuRef, rowMenuRef].some((r) => r.current?.contains(t));
    const onDoc = (e: MouseEvent) => { if (!inside(e.target as Node)) { setHeadMenu(null); setRowMenu(null); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setHeadMenu(null); setRowMenu(null); } };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [headMenu, rowMenu]);

  const toggleSel = (id: string) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const bulkDelete = async (only?: string[]) => {
    const ids = only ?? [...selected];
    if (!ids.length) return;
    if (!(await confirmDialog({ message: `Eliminar ${ids.length} produto(s)? Produtos com vendas não podem ser apagados (constam de faturas): ficam apenas desativados.`, danger: true }))) return;
    setBusy(true); setError(null);
    let del = 0, deact = 0;
    try {
      // Lotes de 200 no endpoint em lote: rápido e com percentagem real no ecrã.
      const r = await runBulk({
        title: 'A eliminar produtos',
        items: ids,
        batchSize: 200,
        run: async (lote) => {
          try {
            const x = await api.products.removeMany(lote);
            del += x.deleted; deact += x.deactivated;
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 404) throw e;
            // API ainda sem o endpoint em lote (deploy em curso): recorre ao 1 a 1.
            for (const id of lote) { const x = await api.products.remove(id); if (x.deleted) del++; else deact++; }
          }
        },
      });
      setProducts((prev) => prev.filter((p) => !ids.includes(p.id)));
      setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; }); await load({ silent: true });
      // Produto JÁ VENDIDO consta de faturas emitidas e a lei não deixa apagá-lo: é
      // DESATIVADO (sai do Caixa e da loja; o histórico fica). Não é um erro — só
      // as falhas verdadeiras vão a vermelho.
      const aviso = deact > 0
        ? `${deact} produto(s) já tinham vendas e por isso não podem ser apagados (constam de faturas emitidas): ficaram desativados — já não aparecem no Caixa nem na loja online, e o histórico fica intacto.`
        : '';
      if (r.failed > 0) {
        const parts = [`${del} eliminado(s)`];
        if (deact > 0) parts.push(`${deact} com vendas foram desativados`);
        parts.push(`${r.failed} não puderam ser eliminados (${r.firstError})`);
        setError(`${parts.join('; ')}.`);
      } else if (deact > 0) {
        toast.warning(del > 0 ? `${del} eliminado(s). ${aviso}` : aviso);
      } else {
        toast.success(`${del} produto(s) eliminado(s).`);
      }
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao eliminar.'); }
    finally { setBusy(false); }
  };

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    if (!opts?.silent) setError(null);
    try {
      // CATÁLOGO UNIFICADO: produtos vendíveis + ingredientes (matéria-prima) na
      // MESMA lista. Os ingredientes distinguem-se pela etiqueta 'matéria-prima'.
      const { q: term, pages: n } = queryRef.current;
      api.products.stats().then(setStats).catch(() => setStats(null));
      const [prods, ings] = await Promise.all([
        api.products.listAll({ q: term, limit: PAGE * n }),
        term ? Promise.resolve([] as ManagerProduct[]) : api.products.ingredients().catch(() => [] as ManagerProduct[]),
      ]);
      setHasMore(prods.length >= PAGE * n);
      const seen = new Set(prods.map((p) => p.id));
      setProducts([...prods, ...ings.filter((i) => !seen.has(i.id))].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Só o RESTAURANTE usa ingredientes/produção (ficha técnica). Noutros negócios
  // os toggles não fazem sentido e ficam escondidos.
  const [isRestaurant, setIsRestaurant] = useState(false);
  // Farmácia/clínica/hospital: medicamentos sujeitos a receita médica.
  const [isHealth, setIsHealth] = useState(false);
  useEffect(() => { api.branding().then((b) => { const t = (b.businessType || '').toUpperCase(); setIsRestaurant(t === 'RESTAURANT'); setIsHealth(['PHARMACY', 'FARMACIA', 'CLINIC', 'HOSPITAL'].includes(t)); }).catch(() => undefined); }, []);
  // Disponibilidade dos produtos de PRODUÇÃO (Livre / Ocupado / Esgotado).
  const [avail, setAvail] = useState<Record<string, 'FREE' | 'BUSY' | 'OUT'>>({});
  const loadAvail = useCallback(() => {
    api.restaurant.availability()
      .then((rows) => setAvail(Object.fromEntries(rows.map((r) => [r.id, r.status]))))
      .catch(() => undefined); // vertical não-restaurante: simplesmente não há
  }, []);
  useEffect(() => {
    void load();
    api.inventory.warehouses().then(setStores).catch(() => undefined);
    api.inventory.categories().then(setCategories).catch(() => undefined);
    loadAvail();
    // TEMPO REAL: atualiza stock/disponibilidade sem o utilizador recarregar
    // (uma venda no caixa ou uma fornada reflete-se aqui em segundos).
    const t = pollEvery(() => { void load({ silent: true }); loadAvail(); }, 10000);
    return () => stopPoll(t);
  }, [load, loadAvail]);
  const availBadge = (id: string) => {
    const s = avail[id];
    if (!s) return null;
    const m = { FREE: ['#16a34a', 'Livre'], BUSY: ['#ca8a04', 'Ocupado'], OUT: ['#dc2626', 'Esgotado'] }[s];
    return <span className="pill" style={{ marginLeft: 6, fontSize: 10.5 }}><span className="ui-dot" style={{ background: m[0] }} aria-hidden="true" /> {m[1]}</span>;
  };

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const cat = await api.inventory.createCategory(name);
      setCategories((p) => (p.some((c) => c.id === cat.id) ? p : [...p, cat].sort((a, b) => a.name.localeCompare(b.name))));
      setForm((f) => ({ ...f, categoryId: cat.id }));
      setNewCategory('');
    } catch { /* ignora */ }
  };

  const openCreate = () => {
    setForm({ ...EMPTY });
    setFormError(null);
    setCreating(true);
  };
  // "+" da barra de topo → "Produto": abre já o formulário de criação.
  useEffect(() => { if (takeQuickCreate('products')) openCreate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (p: ManagerProduct) => {
    setForm({
      code: p.code,
      barcode: p.barcode ?? '',
      name: p.name,
      description: p.description ?? '',
      brand: p.brand ?? '',
      ivaCode: p.iva_code,
      exemptionCode: p.exemption_code ?? '',
      unitPrice: p.unit_price,
      costPrice: p.cost_price ?? '',
      stockQty: p.stock_qty,
      purchaseTotal: '',
      categoryId: p.category_id ?? '',
      storeIds: [],
      allStores: true,
      sharedStock: p.shared_stock,
      imageUrl: p.image_url ?? '',
      showOnline: p.show_online,
      isActive: p.is_active,
      isIngredient: !!p.is_ingredient,
      isProduction: !!p.is_production,
      unit: p.unit ?? '',
      requiresPrescription: !!p.requires_prescription,
    });
    setFormError(null);
    setEditing(p);
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_500_000) {
      setFormError('Imagem demasiado grande (máx. ~1,5 MB).');
      return;
    }
    void readFileProgress(file).then((data) => setForm((f) => ({ ...f, imageUrl: data })));
  };

  const save = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Indique o nome do produto.');
      return;
    }
    // Ingrediente (matéria-prima) não se vende → preço opcional (0 se vazio).
    const price = (form.isIngredient && form.unitPrice.trim() === '') ? 0 : Number(form.unitPrice);
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Preço inválido.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.products.update(editing.id, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          categoryId: form.categoryId || undefined,
          brand: form.brand.trim(),
          ivaCode: form.ivaCode,
          ...(isExempt ? { exemptionCode: form.exemptionCode || undefined } : {}),
          unitPrice: price,
          costPrice: Number(form.costPrice) || 0,
          imageUrl: form.imageUrl || undefined,
          showOnline: form.showOnline,
          sharedStock: form.sharedStock,
          isActive: form.isActive,
          isIngredient: form.isIngredient,
          isProduction: form.isProduction,
          unit: form.unit.trim(),
          ...(isHealth ? { requiresPrescription: form.requiresPrescription } : {}),
        });
      } else {
        // Custo unitário = valor de compra (total) ÷ quantidade; se não houver
        // quantidade/valor de compra, cai no custo unitário escrito (se houver).
        const qInit = Number(form.stockQty) || 0;
        const buyTotal = Number(form.purchaseTotal) || 0;
        const unitCost = qInit > 0 && buyTotal > 0 ? Math.round((buyTotal / qInit) * 100) / 100 : (Number(form.costPrice) || 0);
        // Código de barras OPCIONAL — vazio: o sistema gera um EAN-13 interno.
        const payload: CreateProductInput = {
          code: form.code.trim() || undefined,
          barcode: form.code.trim() || undefined,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          categoryId: form.categoryId || undefined,
          brand: form.brand.trim() || undefined,
          ivaCode: form.ivaCode,
          ...(isExempt ? { exemptionCode: form.exemptionCode || undefined } : {}),
          unitPrice: price,
          costPrice: unitCost,
          stockQty: qInit,
          sharedStock: form.sharedStock,
          imageUrl: form.imageUrl || undefined,
          showOnline: form.showOnline,
          isIngredient: form.isIngredient,
          isProduction: form.isProduction,
          unit: form.unit.trim() || undefined,
          ...(isHealth ? { requiresPrescription: form.requiresPrescription } : {}),
        };
        await api.products.create(payload);
      }
      close();
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    } finally {
      setSaving(false);
    }
  };

  const q = search.trim().toLowerCase();
  // A pesquisa já é feita no servidor/memória (nome, código, código de barras, marca).
  const filtered = products;
  // Nova pesquisa → volta à 1.ª página (com uma pequena espera enquanto se escreve).
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) { firstSearch.current = false; return; }
    const t = window.setTimeout(() => { setPages(1); queryRef.current = { q: search.trim(), pages: 1 }; void load(); }, 300);
    return () => window.clearTimeout(t);
  }, [search, load]);
  const loadMore = () => { const n = pages + 1; setPages(n); queryRef.current = { q: search.trim(), pages: n }; void load({ silent: true }); };
  const allSel = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(filtered.map((p) => p.id)));

  // Stock inicial (criar): valores computados em tempo real, como na entrada de stock.
  const siQty = Number(form.stockQty) || 0;
  const siBuy = Number(form.purchaseTotal) || 0;
  const siUnitCost = siQty > 0 && siBuy > 0 ? siBuy / siQty : (Number(form.costPrice) || 0);
  const siSale = Number(form.unitPrice) || 0;
  const siUnitProfit = siSale - siUnitCost;
  const siTotalProfit = siUnitProfit * siQty;
  const siMargin = siSale > 0 ? (siUnitProfit / siSale) * 100 : 0;
  const kz = (n: number) => formatKz(n);

  const sellable = products.filter((p) => !p.is_ingredient && p.is_active);
  // Totais do SERVIDOR (catálogo inteiro); a soma local só serve de recurso (offline).
  const stockValueLocal = sellable.reduce((s, p) => (p.is_production ? s : s + grossUnit(p) * Math.max(0, Number(p.stock_qty))), 0);
  const stockValue = stats?.stockValue ?? stockValueLocal;
  const outOfStock = stats?.outOfStock ?? sellable.filter((p) => !p.is_production && Number(p.stock_qty) <= 0).length;
  const onlineCount = stats?.online ?? products.filter((p) => p.show_online && p.is_active && !p.is_ingredient).length;
  // Desativados (ex.: produtos com vendas que se tentou eliminar) saem da lista normal
  // e ficam no separador "Inativos", de onde se podem reativar (Editar).
  const inactiveCount = products.filter((p) => !p.is_active).length;
  // A lista vem por páginas: com mais por carregar o número é um mínimo ("100+").
  const inactiveLabel = `${inactiveCount}${hasMore ? '+' : ''}`;
  const visible = filtered.filter((p) => {
    if (pfilter === 'OFF') return !p.is_active;
    // A pesquisar, os desativados também aparecem (com a etiqueta "Inativo"): é
    // assim que se encontra um para o reativar.
    if (!p.is_active && !q) return false;
    if (pfilter === 'IN') return !p.is_ingredient && (p.is_production || Number(p.stock_qty) > 0);
    if (pfilter === 'OUT') return !p.is_ingredient && !p.is_production && Number(p.stock_qty) <= 0;
    if (pfilter === 'ONLINE') return !!p.show_online && !p.is_ingredient;
    return true;
  });

  // ── Filtros e tabela (padrão de listagem: filtros → "Mostrar N registos" →
  // tabela ordenável → paginação). Os filtros atuam sobre o que já foi
  // carregado; a pesquisa por texto continua no servidor. ──
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const pvpMinN = num(fPvpMin), pvpMaxN = num(fPvpMax), costMinN = num(fCostMin), costMaxN = num(fCostMax);
  const rows = visible.filter((p) => {
    if (fCat && p.category_id !== fCat) return false;
    if (fType === 'PRODUCT' && (p.is_ingredient || p.is_production)) return false;
    if (fType === 'INGREDIENT' && !p.is_ingredient) return false;
    if (fType === 'PRODUCTION' && !p.is_production) return false;
    if (fOnline === 'ON' && !p.show_online) return false;
    if (fOnline === 'OFF' && p.show_online) return false;
    const pvp = grossUnit(p), cost = Number(p.cost_price) || 0;
    if (pvpMinN != null && pvp < pvpMinN) return false;
    if (pvpMaxN != null && pvp > pvpMaxN) return false;
    if (costMinN != null && cost < costMinN) return false;
    if (costMaxN != null && cost > costMaxN) return false;
    return true;
  });
  const sortVal = (p: ManagerProduct): string | number => {
    switch (sort.key) {
      case 'code': return p.code;
      case 'price': return grossUnit(p);
      case 'cost': return Number(p.cost_price) || 0;
      case 'iva': return IVA_RATE[p.iva_code];
      case 'stock': return Number(p.stock_qty);
      default: return p.name.toLocaleLowerCase('pt');
    }
  };
  const sorted = [...rows].sort((a, b) => {
    const x = sortVal(a), y = sortVal(b);
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt');
    return sort.dir === 'asc' ? r : -r;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const curPage = Math.min(page, pageCount);
  const pageRows = sorted.slice((curPage - 1) * perPage, curPage * perPage);
  const from = sorted.length ? (curPage - 1) * perPage + 1 : 0;
  const to = Math.min(curPage * perPage, sorted.length);
  useEffect(() => { setPage(1); }, [pfilter, fCat, fType, fOnline, fPvpMin, fPvpMax, fCostMin, fCostMax, perPage, search]);
  const pageSel = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));
  const togglePage = () => setSelected((prev) => {
    const n = new Set(prev);
    if (pageSel) pageRows.forEach((p) => n.delete(p.id)); else pageRows.forEach((p) => n.add(p.id));
    return n;
  });
  const clearFilters = () => {
    setSearch(''); setPfilter('ALL'); setFCat(''); setFType('ALL'); setFOnline('ALL');
    setFPvpMin(''); setFPvpMax(''); setFCostMin(''); setFCostMax('');
  };
  const searchNow = () => { setPages(1); queryRef.current = { q: search.trim(), pages: 1 }; void load(); };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`sort${sort.key === k ? ` ${sort.dir}` : ''}${className ? ` ${className}` : ''}`} onClick={() => sortBy(k)}
      aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span className="ar" aria-hidden="true"><span className="u">▲</span><span className="d">▼</span></span>{children}
    </th>
  );
  const pagerNums = (() => {
    const out: (number | '…')[] = [];
    for (let i = 1; i <= pageCount; i++) {
      if (i === 1 || i === pageCount || Math.abs(i - curPage) <= 1) out.push(i);
      else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
  })();
  const catName = (id: string | null) => (id ? categories.find((c) => c.id === id)?.name : undefined);

  // ── FORMULÁRIO (página própria, como na referência) ──
  if (creating || editing) {
    const L = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
      <div className="vd-lbl">{children}{hint ? <span className="q" title={hint} aria-label={hint}>?</span> : null} :</div>
    );
    const pvpPreview = (Number(form.unitPrice) || 0) * (1 + (form.ivaCode === 'AUTO' ? (companyIva ? IVA_RATE[companyIva] ?? 0 : 0) : IVA_RATE[form.ivaCode]) / 100);
    return (
      <div className="vd-page">
        <div className="vd-head">
          <p className="vd-crumb">
            <button onClick={close}>Produtos</button><span className="sep">/</span>
            <span>{editing ? 'Editar produto' : 'Adicionar produto'}</span>
          </p>
        </div>
        {formError ? <div className="vd-err" role="alert">{formError}</div> : null}

        <div className="vd-card vd-form">
          <div className="vd-row"><L hint="Nome que aparece no caixa, nas faturas e na loja online.">Nome do produto</L>
            <div className="vd-ctl"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do produto" autoFocus /></div></div>
          {!editing ? (
            <div className="vd-row"><L hint="Opcional. Vazio: o sistema gera automaticamente um código de barras EAN-13.">Código de barras</L>
              <div className="vd-ctl"><div className="vd-inline">
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Código de barras" inputMode="text" />
                <BarcodeScanner onDetected={(code) => setForm((f) => ({ ...f, code }))} />
              </div></div></div>
          ) : (
            <div className="vd-row"><L>Referência</L>
              <div className="vd-ctl"><input value={`${editing.code}${editing.barcode && editing.barcode !== editing.code ? ` · ${editing.barcode}` : ''}`} readOnly disabled /></div></div>
          )}
          <div className="vd-row"><L>Descrição</L>
            <div className="vd-ctl"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição" /></div></div>
          <div className="vd-row"><L hint="Máximo ~1,5 MB.">Imagem</L>
            <div className="vd-ctl"><div className="vd-file">
              <span className="pv">{form.imageUrl ? <img src={form.imageUrl} alt="" /> : <IconImage size={22} />}</span>
              <label className="vd-btn plain" style={{ cursor: 'pointer' }}>
                <IconImage size={15} /> {form.imageUrl ? 'Trocar imagem' : 'Escolher imagem'}
                <input type="file" accept="image/*" hidden onChange={(e) => onPickImage(e.target.files?.[0])} />
              </label>
              {form.imageUrl ? <button type="button" className="vd-clear" onClick={() => setForm({ ...form, imageUrl: '' })}>Remover</button> : null}
            </div></div></div>
        </div>

        <div className="vd-card vd-form">
          <div className="vd-row two">
            <L>Categoria</L>
            <div className="vd-ctl">
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">-- Sem categoria --</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="vd-inline">
                <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nova categoria"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory(); } }} />
                <button type="button" className="vd-btn outline sm" onClick={() => void addCategory()} disabled={!newCategory.trim()}>Criar</button>
              </div>
            </div>
            <L>Marca</L>
            <div className="vd-ctl"><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Marca" /></div>
          </div>
          <div className="vd-row two">
            <L hint="Como este produto se mede: o stock, as compras e a ficha técnica passam a mostrar esta unidade.">Unidade</L>
            <div className="vd-ctl">
              <select value={UNIT_OPTIONS.includes(form.unit) ? form.unit : (form.unit ? '__outra' : '')}
                onChange={(e) => setForm({ ...form, unit: e.target.value === '__outra' ? (form.unit || ' ') : e.target.value })}>
                <option value="">-- Sem unidade --</option>
                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                <option value="__outra">Outra…</option>
              </select>
              {!UNIT_OPTIONS.includes(form.unit) && form.unit !== '' ? (
                <input value={form.unit.trim()} maxLength={16} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="ex.: rolo, saco" />
              ) : null}
            </div>
            <L>Tipo</L>
            <div className="vd-ctl">
              <select value={form.isIngredient ? 'ING' : form.isProduction ? 'PROD' : 'P'} disabled={!isRestaurant}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm({ ...form, isIngredient: v === 'ING', isProduction: v === 'PROD', showOnline: v === 'ING' ? false : form.showOnline });
                }}>
                <option value="P">Produto</option>
                {isRestaurant ? <option value="ING">Matéria-prima (ingrediente)</option> : null}
                {isRestaurant ? <option value="PROD">Produção (ficha técnica)</option> : null}
              </select>
            </div>
          </div>
        </div>

        <div className="vd-card vd-form">
          <p className="vd-sect">Preço e imposto</p>
          <div className="vd-row two">
            <L hint="Preço de venda sem IVA, em Kz.">Preço s/ IVA</L>
            <div className="vd-ctl"><input inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0" /></div>
            <L>PVP</L>
            <div className="vd-ctl"><input value={form.ivaCode === 'AUTO' && !companyIva ? 'IVA da empresa' : kz(pvpPreview)} readOnly disabled /></div>
          </div>
          <div className="vd-row"><L hint="Automático usa o IVA padrão da empresa (Configurações).">Imposto</L>
            <div className="vd-ctl">
              <select value={form.ivaCode} onChange={(e) => setForm({ ...form, ivaCode: e.target.value as IvaCode | 'AUTO' })}>
                <option value="AUTO">Automático (padrão da empresa)</option>
                {IVA_OPTIONS.map((c) => <option key={c} value={c}>{c} ({IVA_RATE[c]}%)</option>)}
              </select>
            </div></div>
          {isExempt ? (
            <div className="vd-row"><L hint="Código oficial da AGT: vai no recibo, no SAF-T e na Facturação Electrónica. Sem ele a AGT rejeita o documento.">Motivo de isenção</L>
              <div className="vd-ctl">
                <select value={form.exemptionCode} onChange={(e) => setForm({ ...form, exemptionCode: e.target.value })} aria-label="Código de isenção (AGT)">
                  <option value="">{form.ivaCode === 'OUT' ? 'M02 — Operação não sujeita (por omissão)' : 'Escolha o motivo da isenção (obrigatório)…'}</option>
                  {TAX_EXEMPTIONS.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.hint}</option>)}
                </select>
              </div></div>
          ) : null}
          {form.isProduction ? (
            <div className="vd-row"><L>Custo e stock</L>
              <div className="vd-ctl" style={{ paddingTop: 8, fontSize: 14 }}>Calculados pela ficha técnica e pelas fornadas.</div></div>
          ) : !editing ? (
            <>
              <div className="vd-row two">
                <L>Stock inicial</L>
                <div className="vd-ctl"><input inputMode="decimal" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} placeholder="0" /></div>
                <L hint="Total pago pela quantidade inicial. O custo unitário é calculado automaticamente.">Valor de compra</L>
                <div className="vd-ctl"><input inputMode="decimal" value={form.purchaseTotal} onChange={(e) => setForm({ ...form, purchaseTotal: e.target.value })} placeholder="0" /></div>
              </div>
              <div className="vd-row"><div />
                <div className="vd-ctl" style={{ maxWidth: 'none' }}>
                  <div className="vd-kv">
                    <div><small>Custo unitário</small><b>{kz(siUnitCost)}</b></div>
                    <div><small>Lucro unitário</small><b style={{ color: siUnitProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{kz(siUnitProfit)}</b></div>
                    <div><small>Lucro total</small><b style={{ color: siTotalProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{kz(siTotalProfit)}</b></div>
                    <div><small>Margem</small><b>{siMargin.toFixed(1)}%</b></div>
                  </div>
                </div></div>
            </>
          ) : (
            <div className="vd-row"><L>Preço de custo</L>
              <div className="vd-ctl"><input inputMode="decimal" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} placeholder="0" /></div></div>
          )}
        </div>

        <div className="vd-card">
          <div className="vd-form">
            <p className="vd-sect">Opções</p>
            {stores.length > 1 ? (
              <div className="vd-row"><L hint={form.sharedStock ? 'Stock único partilhado por todas as lojas.' : 'Cada loja gere o seu próprio stock.'}>Stock partilhado</L>
                <div className="vd-ctl"><div className="vd-check"><Switch checked={form.sharedStock} onChange={(v) => setForm({ ...form, sharedStock: v })} /> {form.sharedStock ? 'Sim' : 'Não'}</div></div></div>
            ) : null}
            {isHealth && !form.isIngredient ? (
              <div className="vd-row"><L hint="O caixa só vende com o nº da receita (fica registado na auditoria).">Exige receita médica</L>
                <div className="vd-ctl"><div className="vd-check"><Switch checked={form.requiresPrescription} onChange={(v) => setForm({ ...form, requiresPrescription: v })} /> {form.requiresPrescription ? 'Sim' : 'Não'}</div></div></div>
            ) : null}
            {!form.isIngredient ? (
              <div className="vd-row"><L>Loja online</L>
                <div className="vd-ctl"><div className="vd-check"><Switch checked={form.showOnline} onChange={(v) => setForm({ ...form, showOnline: v })} /> {form.showOnline ? 'Visível' : 'Oculto'}</div></div></div>
            ) : null}
            {editing ? (
              <div className="vd-row"><L hint="Inativo: sai do caixa e da loja online; o histórico fica.">Estado</L>
                <div className="vd-ctl"><div className="vd-check"><Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} /> {form.isActive ? 'Ativo' : 'Inativo'}</div></div></div>
            ) : null}
          </div>
          <div className="vd-actions">
            <button className="vd-btn plain" onClick={close} disabled={saving}>Cancelar</button>
            <button className="vd-btn" onClick={save} disabled={saving}>{saving ? 'A guardar…' : editing ? 'Guardar alterações' : 'Adicionar produto'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── LISTAGEM ──
  const hasRecipes = products.some((p) => p.has_recipe);
  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Produtos</span><span className="sep">/</span><span>Listagem</span></p>
        <span className="spacer" />
        <div className="vd-split" ref={headMenuRef}>
          <button className="vd-btn" onClick={openCreate}><IconPlus size={16} /> Adicionar produto</button>
          <button className="vd-btn caret" aria-label="Mais opções de criação" aria-expanded={headMenu === 'add'} onClick={() => setHeadMenu((m) => (m === 'add' ? null : 'add'))}><IconChevronDown size={16} /></button>
          {headMenu === 'add' ? (
            <div className="vd-drop" role="menu">
              <button role="menuitem" onClick={() => { setHeadMenu(null); setEnterFor(undefined); setEntering(true); }} disabled={stores.length === 0 || products.length === 0}><IconTruck size={15} /> Adicionar stock</button>
              {hasRecipes ? <button role="menuitem" onClick={() => { setHeadMenu(null); setProducing(true); }}>Registar fornada</button> : null}
            </div>
          ) : null}
        </div>
        <div className="vd-split" ref={moreMenuRef}>
          <button className="vd-btn outline" aria-expanded={headMenu === 'more'} onClick={() => setHeadMenu((m) => (m === 'more' ? null : 'more'))}><IconChevronDown size={15} /> Mais</button>
          {headMenu === 'more' ? (
            <div className="vd-drop" role="menu">
              <button role="menuitem" onClick={() => { setHeadMenu(null); toggleAll(); }} disabled={filtered.length === 0}>{allSel ? 'Desmarcar todos' : 'Selecionar todos'}</button>
              <button role="menuitem" onClick={() => { setHeadMenu(null); setPfilter('OFF'); }} disabled={inactiveCount === 0}>Ver inativos ({inactiveLabel})</button>
              <hr />
              <button role="menuitem" className="danger" onClick={() => { setHeadMenu(null); void bulkDelete(); }} disabled={selected.size === 0 || busy}>Eliminar selecionados ({selected.size})</button>
            </div>
          ) : null}
        </div>
      </div>

      <form className="vd-card vd-filters" onSubmit={(e) => { e.preventDefault(); searchNow(); }}>
        <div className="vd-frow">
          <label className="vd-f grow"><input className="vd-in" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisa por nome, referência ou código de barras" aria-label="Procurar produtos" /></label>
          <label className="vd-f"><select value={fCat} onChange={(e) => setFCat(e.target.value)} aria-label="Categorias">
            <option value="">Categorias</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
          <label className="vd-f"><select value={fOnline} onChange={(e) => setFOnline(e.target.value as typeof fOnline)} aria-label="Loja online">
            <option value="ALL">Loja online</option><option value="ON">Visível online</option><option value="OFF">Oculto online</option>
          </select></label>
        </div>
        <div className="vd-frow">
          <div className="vd-f"><span>PVP</span><div className="vd-range">
            <input inputMode="decimal" value={fPvpMin} onChange={(e) => setFPvpMin(e.target.value)} placeholder="Min" aria-label="PVP mínimo" />
            <span className="mid">até</span>
            <input inputMode="decimal" value={fPvpMax} onChange={(e) => setFPvpMax(e.target.value)} placeholder="Max" aria-label="PVP máximo" />
          </div></div>
          <div className="vd-f"><span>Preço de custo</span><div className="vd-range">
            <input inputMode="decimal" value={fCostMin} onChange={(e) => setFCostMin(e.target.value)} placeholder="Min" aria-label="Custo mínimo" />
            <span className="mid">até</span>
            <input inputMode="decimal" value={fCostMax} onChange={(e) => setFCostMax(e.target.value)} placeholder="Max" aria-label="Custo máximo" />
          </div></div>
          <label className="vd-f"><span>Stock</span><select value={pfilter === 'IN' || pfilter === 'OUT' ? pfilter : 'ALL'} onChange={(e) => setPfilter(e.target.value as typeof pfilter)}>
            <option value="ALL">Todos</option><option value="IN">Com stock</option><option value="OUT">Sem stock</option>
          </select></label>
          <label className="vd-f"><span>Estado</span><select value={pfilter === 'OFF' ? 'OFF' : 'ON'} onChange={(e) => setPfilter(e.target.value === 'OFF' ? 'OFF' : 'ALL')}>
            <option value="ON">Ativo</option><option value="OFF">Inativo</option>
          </select></label>
          <label className="vd-f"><span>Filtrar por tipo</span><select value={fType} onChange={(e) => setFType(e.target.value as typeof fType)}>
            <option value="ALL">Todos</option><option value="PRODUCT">Produto</option>
            {isRestaurant || products.some((p) => p.is_ingredient) ? <option value="INGREDIENT">Matéria-prima</option> : null}
            {isRestaurant || products.some((p) => p.is_production) ? <option value="PRODUCTION">Produção</option> : null}
          </select></label>
        </div>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <div className="vd-cols">
            {([['code', 'Referência'], ['price', 'Preço'], ['cost', 'Preço de custo'], ['iva', 'Imposto'], ['stock', 'Stock'], ['cat', 'Categoria']] as [keyof typeof cols, string][]).map(([k, l]) => (
              <label key={k}><input type="checkbox" checked={cols[k]} onChange={() => setCols((c) => ({ ...c, [k]: !c[k] }))} /> {l}</label>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="vd-clear" onClick={clearFilters}>✕ Limpar</button>
          <button type="submit" className="vd-btn outline"><IconSearch size={15} /> Pesquisar</button>
        </div>
      </form>

      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="vd-card vd-tablecard">
        <div className="vd-tbar">
          <label>Mostrar <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            {[20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select> registos</label>
          <span className="spacer" />
          <div className="vd-sum">
            <span>Produtos <b>{stats?.sellable ?? sellable.length}</b></span>
            <span>Valor em stock <b>{formatKz(stockValue)}</b></span>
            <span>Sem stock <b className={outOfStock ? 'bad' : ''}>{outOfStock}</b></span>
            <span>Online <b>{onlineCount}</b></span>
          </div>
        </div>
        {selected.size > 0 ? (
          <div className="vd-bulk">
            <strong>{selected.size} selecionado(s)</strong>
            <span className="spacer" />
            <button className="vd-btn plain sm" onClick={() => setSelected(new Set())} disabled={busy}>Limpar</button>
            <button className="vd-btn danger sm" onClick={() => void bulkDelete()} disabled={busy}>Eliminar</button>
          </div>
        ) : null}
        {loading ? (
          <div className="vd-empty">A carregar produtos…</div>
        ) : pageRows.length === 0 ? (
          <div className="vd-empty">{q || pfilter !== 'ALL' || fCat || fType !== 'ALL' || fOnline !== 'ALL' ? 'Nenhum produto encontrado.' : 'Ainda não há produtos.'}</div>
        ) : (
          <div className="vd-tablewrap">
            <table className="vd-table">
              <thead>
                <tr>
                  <th className="chk"><input type="checkbox" checked={pageSel} onChange={togglePage} aria-label="Selecionar a página" /></th>
                  {cols.code ? <Th k="code">Ref</Th> : null}
                  <Th k="name">Nome</Th>
                  {cols.cat ? <th>Categoria</th> : null}
                  {cols.price ? <Th k="price" className="num">Preço</Th> : null}
                  {cols.cost ? <Th k="cost" className="num">Preço de custo</Th> : null}
                  {cols.iva ? <Th k="iva" className="ctr">IVA</Th> : null}
                  {cols.stock ? <Th k="stock" className="ctr">Stock</Th> : null}
                  <th aria-label="Opções" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p, i) => {
                  const qty = Number(p.stock_qty);
                  const tracked = !p.is_production && !p.is_ingredient;
                  return (
                    <tr key={p.id} className={`${selected.has(p.id) ? 'sel' : ''}${!p.is_active ? ' off' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}>
                      <td className="chk"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} aria-label={`Selecionar ${p.name}`} /></td>
                      {cols.code ? <td><button className="vd-link" onClick={() => openEdit(p)}>{p.code}</button>{p.barcode && p.barcode !== p.code ? <span className="sub">{p.barcode}</span> : null}</td> : null}
                      <td>
                        <div className="vd-name">
                          {p.image_url ? <img className="vd-thumb" src={p.image_url} alt="" loading="lazy" />
                            : <span className="vd-thumb" style={{ background: monoColor(p.name) }} aria-hidden="true">{monoOf(p.name)}</span>}
                          <div>
                            <button className="vd-link" onClick={() => openEdit(p)}>{p.name}</button>
                            <div>
                              {p.is_ingredient ? <span className="vd-tag warn">Matéria-prima</span> : null}
                              {p.is_production ? <span className="vd-tag info">Produção</span> : null}
                              {p.is_production ? availBadge(p.id) : null}
                              {!p.is_active ? <span className="vd-tag bad">Inativo</span> : tracked && p.show_online ? <span className="vd-tag ok">Online</span> : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      {cols.cat ? <td>{catName(p.category_id) ?? '—'}</td> : null}
                      {cols.price ? <td className="num">{p.is_ingredient ? '—' : formatKz(grossUnit(p))}{!p.is_ingredient ? <span className="sub">S/IVA: {formatKz(Number(p.unit_price))}</span> : null}</td> : null}
                      {cols.cost ? <td className="num">{formatKz(Number(p.cost_price) || 0)}</td> : null}
                      {cols.iva ? <td className="ctr">{IVA_RATE[p.iva_code]}%</td> : null}
                      {cols.stock ? (
                        <td className="ctr">
                          {p.is_production ? <span className="vd-badge mute">—</span>
                            : <span className={`vd-badge${qty <= 0 ? ' bad' : qty <= 5 && !p.is_ingredient ? ' warn' : ''}`}>{qty.toLocaleString('pt-PT')}</span>}
                          {p.unit ? <span className="sub">{p.unit}</span> : null}
                        </td>
                      ) : null}
                      <td className="num">
                        <div className="vd-opts" ref={rowMenu === p.id ? rowMenuRef : undefined}>
                          <button className="vd-btn plain" aria-expanded={rowMenu === p.id} onClick={() => setRowMenu((m) => (m === p.id ? null : p.id))}>Opções <IconChevronDown size={13} /></button>
                          {rowMenu === p.id ? (
                            <div className="vd-drop" role="menu">
                              <button role="menuitem" onClick={() => { setRowMenu(null); openEdit(p); }}><IconEdit size={15} /> Editar</button>
                              <button role="menuitem" onClick={() => { setRowMenu(null); setEnterFor(p.id); setEntering(true); }} disabled={stores.length === 0}><IconTruck size={15} /> Adicionar stock</button>
                              <hr />
                              <button role="menuitem" className="danger" onClick={() => { setRowMenu(null); void bulkDelete([p.id]); }} disabled={busy}>Eliminar</button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && sorted.length > 0 ? (
          <div className="vd-foot">
            <span>A mostrar {from} a {to} de {sorted.length}{hasMore ? '+' : ''} registos</span>
            <span className="spacer" />
            {hasMore ? <button className="vd-btn outline sm" onClick={loadMore}>Carregar mais do servidor</button> : null}
            {pageCount > 1 ? (
              <div className="vd-pager">
                <button onClick={() => setPage(curPage - 1)} disabled={curPage <= 1}>Anterior</button>
                {pagerNums.map((n, i) => n === '…'
                  ? <button key={`e${i}`} disabled>…</button>
                  : <button key={n} className={n === curPage ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
                <button onClick={() => setPage(curPage + 1)} disabled={curPage >= pageCount}>Seguinte</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {entering ? (
        <StockEntryModal
          initialProductId={enterFor}
          products={products}
          warehouses={stores}
          onClose={() => setEntering(false)}
          onSaved={() => { setEntering(false); void load(); }}
        />
      ) : null}

      {producing ? (
        <ProductionModal
          products={products.filter((p) => p.has_recipe)}
          onClose={() => setProducing(false)}
          onSaved={() => { setProducing(false); void load(); }}
        />
      ) : null}
    </div>
  );
}


/** Ordem de produção (fornada) — padaria/pastelaria/produção em lote: escolhe
 *  o produto com ficha técnica e a quantidade; o sistema consome os
 *  ingredientes (com quebra) e dá entrada do produto acabado ao custo real. */
function ProductionModal({
  products, onClose, onSaved,
}: {
  products: ManagerProduct[];
  onClose(): void;
  onSaved(): void;
}) {
  const [code, setCode] = useState(products[0]?.code ?? '');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ produced: number; unitCost: number; costPrice: number; stockAfter: number } | null>(null);
  const sel = products.find((p) => p.code === code);
  const doses = sel?.portions_available == null ? null : Number(sel.portions_available);

  const submit = async () => {
    setErr(null);
    const q = Number(qty);
    if (!code) { setErr('Escolha o produto a produzir.'); return; }
    if (!Number.isFinite(q) || q <= 0) { setErr('Indique a quantidade produzida (ex.: 300).'); return; }
    setBusy(true);
    try { setDone(await api.products.produce({ productCode: code, quantity: q, note: note.trim() || undefined })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível registar a fornada.'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <Modal title="Fornada registada" onClose={onSaved}>
        <div className="banner success" style={{ marginBottom: 12 }}>
          {done.produced.toLocaleString('pt-PT')} un de {sel?.name ?? code} entraram no stock.
        </div>
        <div className="kv"><span className="k">Custo por unidade (ingredientes)</span><span className="v">{done.unitCost.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} Kz</span></div>
        <div className="kv"><span className="k">Custo médio do produto (CMP)</span><span className="v">{done.costPrice.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} Kz</span></div>
        <div className="kv"><span className="k">Stock na prateleira</span><span className="v">{done.stockAfter.toLocaleString('pt-PT')}</span></div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          Os ingredientes já foram descontados do stock. O balcão vende da prateleira; as sobras do dia abatem-se em <strong>Inventário → Acertos</strong>.
        </p>
        <button className="btn lg block" style={{ marginTop: 12 }} onClick={onSaved}>Fechar</button>
      </Modal>
    );
  }

  return (
    <Modal title="Registar fornada (produção)" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        A fornada consome os <strong>ingredientes da ficha técnica</strong> (com a quebra definida) e dá entrada do produto acabado no stock — o balcão passa a vender da prateleira.
      </p>
      <div className="field"><label>Produto a produzir</label>
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {products.map((p) => <option key={p.id} value={p.code}>{p.name} ({p.code})</option>)}
        </select></div>
      <div className="field"><label>Quantidade produzida{sel?.unit ? ` (${sel.unit})` : ''}</label>
        <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="ex.: 300" autoFocus />
        {doses != null ? (
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Com o stock atual de ingredientes dá para produzir até <strong>{doses.toLocaleString('pt-PT')}</strong>.
          </p>
        ) : null}
      </div>
      <div className="field"><label>Nota (opcional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: fornada da manhã" maxLength={120} /></div>
      <button className="btn lg block" onClick={() => void submit()} disabled={busy}>
        {busy ? 'A registar…' : 'Registar fornada'}
      </button>
    </Modal>
  );
}
