import { confirmDialog } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CreateProductInput, IvaCode, ManagerProduct, WarehouseRow } from '../api/types';
import { IVA_RATE } from '../api/types';
import { IconCube, IconEdit, IconImage, IconPlus, IconSearch, IconTruck } from '../components/Icons';
import { Modal, Switch } from '../components/ui';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { StockEntryModal } from './Inventory';
import { formatKz } from '../format';

const IVA_OPTIONS: IvaCode[] = ['NOR', 'INT', 'RED', 'ISE', 'OUT'];

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
  unit: string;
}

const EMPTY: FormState = {
  code: '',
  barcode: '',
  name: '',
  description: '',
  brand: '',
  ivaCode: 'AUTO',
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
  unit: '',
};

/** Unidades de medida comuns (informativas — sem conversão automática). */
const UNIT_OPTIONS = ['un', 'kg', 'g', 'L', 'ml', 'fatia', 'folha', 'dose', 'porção', 'caixa', 'pacote', 'garrafa', 'lata'];

export function Products() {
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [stores, setStores] = useState<WarehouseRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ManagerProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [producing, setProducing] = useState(false);
  // Vista: produtos vendíveis OU ingredientes (matéria-prima).
  const [view, setView] = useState<'products' | 'ingredients'>('products');

  const toggleSel = (id: string) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const bulkDeactivate = async () => {
    setBusy(true); setError(null);
    try {
      for (const id of selected) await api.products.update(id, { isActive: false });
      setSelected(new Set()); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao desativar.'); }
    finally { setBusy(false); }
  };

  const bulkDelete = async () => {
    if (!(await confirmDialog({ message: `Eliminar ${selected.size} produto(s)? Produtos com vendas associadas são apenas desativados.`, danger: true }))) return;
    setBusy(true); setError(null);
    let del = 0, deact = 0;
    try {
      for (const id of selected) { const r = await api.products.remove(id); if (r.deleted) del++; else deact++; }
      setSelected(new Set()); await load();
      setError(null);
      if (deact > 0) setError(`${del} eliminado(s); ${deact} com vendas foram desativados.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao eliminar.'); }
    finally { setBusy(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await (view === 'ingredients' ? api.products.ingredients() : api.products.list()));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
    api.inventory.warehouses().then(setStores).catch(() => undefined);
    api.inventory.categories().then(setCategories).catch(() => undefined);
  }, [load]);

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
    setForm({ ...EMPTY, isIngredient: view === 'ingredients' });
    setFormError(null);
    setCreating(true);
  };

  const openEdit = (p: ManagerProduct) => {
    setForm({
      code: p.code,
      barcode: p.barcode ?? '',
      name: p.name,
      description: p.description ?? '',
      brand: p.brand ?? '',
      ivaCode: p.iva_code,
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
      unit: p.unit ?? '',
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
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, imageUrl: String(reader.result) }));
    reader.readAsDataURL(file);
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
          unitPrice: price,
          costPrice: Number(form.costPrice) || 0,
          imageUrl: form.imageUrl || undefined,
          showOnline: form.showOnline,
          sharedStock: form.sharedStock,
          isActive: form.isActive,
          isIngredient: form.isIngredient,
          unit: form.unit.trim(),
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
          unitPrice: price,
          costPrice: unitCost,
          stockQty: qInit,
          sharedStock: form.sharedStock,
          imageUrl: form.imageUrl || undefined,
          showOnline: form.showOnline,
          isIngredient: form.isIngredient,
          unit: form.unit.trim() || undefined,
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
  const filtered = q
    ? products.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    : products;
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
  const kz = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 2 }) + ' Kz';

  return (
    <>
      <div className="sticky-top">
        <div className="content-head">
          <h2>{view === 'ingredients' ? 'Ingredientes (matéria-prima)' : 'Catálogo de produtos'}</h2>
          <div className="seg" style={{ display: 'inline-flex', gap: 4, marginLeft: 10, background: 'var(--surface-2)', borderRadius: 10, padding: 3 }}>
            <button className={`btn sm ${view === 'products' ? '' : 'ghost'}`} onClick={() => setView('products')}>Produtos</button>
            <button className={`btn sm ${view === 'ingredients' ? '' : 'ghost'}`} onClick={() => setView('ingredients')}>Ingredientes</button>
          </div>
          <span className="spacer" />
          {view === 'products' ? (
            <>
              {/* Fornada (padaria/pastelaria/produção): só aparece se houver
                  produtos com ficha técnica — não polui os outros negócios. */}
              {products.some((p) => p.has_recipe) ? (
                <button className="btn ghost" onClick={() => setProducing(true)}>
                  🥖 Fornada
                </button>
              ) : null}
              <button className="btn ghost" onClick={() => setEntering(true)} disabled={stores.length === 0 || products.length === 0}>
                <IconTruck size={16} /> Adicionar stock
              </button>
            </>
          ) : null}
          <button className="btn" onClick={openCreate}>
            <IconPlus size={18} /> {view === 'ingredients' ? 'Novo ingrediente' : 'Novo produto'}
          </button>
        </div>

        <div className="card toolbar-sticky" style={{ padding: '2px 14px' }}>
          <div className="row">
            <IconSearch size={18} />
            <input
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '13px 0', color: 'var(--text)' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Procurar por nome ou código…"
            />
            {filtered.length > 0 ? (
              <label className="row" style={{ gap: 6, fontSize: 12.5, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todos" /> Todos
              </label>
            ) : null}
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
            <strong>{selected.size} selecionado(s)</strong>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setSelected(new Set())} disabled={busy}>Limpar</button>
            <button className="btn sm warn" onClick={bulkDeactivate} disabled={busy}>Desativar</button>
            <button className="btn sm danger" onClick={bulkDelete} disabled={busy}>Eliminar</button>
          </div>
        ) : null}
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      {loading ? (
        <div className="card"><div className="loading">A carregar produtos…</div></div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty">
            <IconCube size={40} />
            <p>{q ? 'Nenhum produto encontrado.' : 'Ainda não há produtos. Crie o primeiro.'}</p>
          </div>
        </div>
      ) : (
        <div className="pgrid">
          {filtered.map((p) => (
            <div className={`pcard${selected.has(p.id) ? ' sel' : ''}`} key={p.id}>
              <label className="pcard-check" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} />
              </label>
              <div className="thumb">
                {p.image_url ? <img src={p.image_url} alt={p.name} /> : <IconImage size={30} />}
              </div>
              <div className="pinfo">
                <div className="pname">{p.name}</div>
                <div className="pcode">{p.code} · {p.iva_code} · stock {Number(p.stock_qty)}</div>
                <div className="pfoot">
                  <span className="pprice">{formatKz(grossUnit(p))}</span>
                  <span className={`pill ${p.show_online ? 'on' : 'off'}`}>
                    {p.show_online ? 'Online' : 'Oculto'}
                  </span>
                </div>
                <button className="btn sm ghost block" style={{ marginTop: 8 }} onClick={() => openEdit(p)}>
                  <IconEdit size={15} /> Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating || editing ? (
        <Modal title={editing ? 'Editar produto' : 'Novo produto'} onClose={close}>
          {formError ? <div className="banner danger" style={{ marginBottom: 12 }}>{formError}</div> : null}

          <div className="thumb" style={{ height: 130, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 12, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {form.imageUrl ? (
              <img src={form.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <IconImage size={34} />
            )}
          </div>
          <label className="btn sm ghost block" style={{ marginBottom: 12, cursor: 'pointer' }}>
            <IconImage size={15} /> {form.imageUrl ? 'Trocar imagem' : 'Carregar imagem'}
            <input type="file" accept="image/*" hidden onChange={(e) => onPickImage(e.target.files?.[0])} />
          </label>

          {!editing ? (
            <div className="field">
              <label>Código de barras (opcional)</label>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input style={{ flex: 1 }} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Leia pela câmara, escreva — ou deixe vazio" inputMode="text" />
                <BarcodeScanner onDetected={(code) => setForm((f) => ({ ...f, code }))} />
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                Se deixares vazio, o sistema <strong>gera automaticamente</strong> um código de barras (EAN-13) para este produto.
              </p>
            </div>
          ) : null}
          <div className="field">
            <label>Nome</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do produto" />
          </div>
          <div className="field">
            <label>Descrição</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Opcional" />
          </div>
          <div className="field">
            <label>Marca (opcional)</label>
            <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="ex.: Coca-Cola, Nestlé" />
          </div>
          <div className="field">
            <label>Categoria (opcional)</label>
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">— Sem categoria —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <input style={{ flex: 1 }} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nova categoria…"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory(); } }} />
              <button type="button" className="btn sm ghost" onClick={() => void addCategory()} disabled={!newCategory.trim()}>+ Criar</button>
            </div>
          </div>
          <div className="field">
            <label>Preço de venda (Kz, sem IVA)</label>
            <input inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0" />
          </div>
          <div className="field">
            <label>Unidade de medida{form.isIngredient ? '' : ' (opcional)'}</label>
            <select value={UNIT_OPTIONS.includes(form.unit) ? form.unit : (form.unit ? '__outra' : '')}
              onChange={(e) => setForm({ ...form, unit: e.target.value === '__outra' ? form.unit : e.target.value })}>
              <option value="">— Sem unidade —</option>
              {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              <option value="__outra">Outra…</option>
            </select>
            {!UNIT_OPTIONS.includes(form.unit) && form.unit !== '' ? (
              <input style={{ marginTop: 6 }} value={form.unit} maxLength={16}
                onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="ex.: rolo, saco…" />
            ) : null}
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Como este produto se mede: o stock, as compras e a ficha técnica passam a mostrar esta unidade (ex.: carne em <strong>kg</strong>, queijo à <strong>fatia</strong>, molho em <strong>ml</strong>).
            </p>
          </div>
          {!editing ? (
            <div className="card" style={{ background: 'var(--surface-2)', padding: 12, margin: '0 0 12px' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Stock inicial (opcional)</div>
              <div className="field">
                <label>Quantidade</label>
                <input inputMode="decimal" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} placeholder="0" />
              </div>
              <div className="field">
                <label>Valor de compra (total da quantidade, Kz)</label>
                <input inputMode="decimal" value={form.purchaseTotal} onChange={(e) => setForm({ ...form, purchaseTotal: e.target.value })} placeholder="0" />
              </div>
              <div className="kv"><span className="k">Custo unitário</span><span className="v">{kz(siUnitCost)}</span></div>
              <div className="kv"><span className="k">Lucro unitário</span><span className="v" style={{ color: siUnitProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{kz(siUnitProfit)}</span></div>
              <div className="kv"><span className="k">Lucro total</span><span className="v" style={{ color: siTotalProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{kz(siTotalProfit)}</span></div>
              <div className="kv"><span className="k">Margem</span><span className="v">{siMargin.toFixed(1)}%</span></div>
            </div>
          ) : (
            <div className="field">
              <label>Custo unitário (Kz)</label>
              <input inputMode="decimal" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} placeholder="0" />
            </div>
          )}
          <div className="field">
            <label>IVA</label>
            <select value={form.ivaCode} onChange={(e) => setForm({ ...form, ivaCode: e.target.value as IvaCode | 'AUTO' })}>
              <option value="AUTO">Automático (padrão da empresa — configurável em Configurações)</option>
              {IVA_OPTIONS.map((c) => (
                <option key={c} value={c}>{c} ({IVA_RATE[c]}%)</option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Isento/não sujeito? O motivo legal vai automaticamente no recibo — não precisas de escrever nada.
            </p>
          </div>
          {stores.length > 1 ? (
            <div className="field">
              <div className="switch-row" style={{ padding: 0 }}>
                <span>Stock central partilhado</span>
                <Switch checked={form.sharedStock} onChange={(v) => setForm({ ...form, sharedStock: v })} />
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                {form.sharedStock
                  ? 'Stock único partilhado por todas as lojas — qualquer loja vende do mesmo saldo.'
                  : 'Stock por loja — cada loja gere e vê o seu próprio stock. Dê entrada de stock em cada loja.'}
              </p>
            </div>
          ) : null}

          <div className="switch-row">
            <span>É ingrediente (matéria-prima)<br /><small className="muted">Não se vende no caixa nem na loja — só para a ficha técnica dos pratos.</small></span>
            <Switch checked={form.isIngredient} onChange={(v) => setForm({ ...form, isIngredient: v, showOnline: v ? false : form.showOnline })} />
          </div>
          {!form.isIngredient ? (
            <div className="switch-row">
              <span>Mostrar na loja online</span>
              <Switch checked={form.showOnline} onChange={(v) => setForm({ ...form, showOnline: v })} />
            </div>
          ) : null}
          {editing ? (
            <div className="switch-row">
              <span>Produto activo</span>
              <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
          ) : null}

          <button className="btn lg block" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
            {saving ? 'A guardar…' : editing ? 'Guardar alterações' : 'Criar produto'}
          </button>
        </Modal>
      ) : null}

      {entering ? (
        <StockEntryModal
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
    </>
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
      <Modal title="Fornada registada 🥖" onClose={onSaved}>
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
