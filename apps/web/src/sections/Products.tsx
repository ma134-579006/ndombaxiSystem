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
  storeIds: string[];
  allStores: boolean;
  sharedStock: boolean;
  imageUrl: string;
  showOnline: boolean;
  isActive: boolean;
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
  storeIds: [],
  allStores: true,
  sharedStock: false,
  imageUrl: '',
  showOnline: true,
  isActive: true,
};

export function Products() {
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [stores, setStores] = useState<WarehouseRow[]>([]);
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
      setProducts(await api.products.list());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    api.inventory.warehouses().then(setStores).catch(() => undefined);
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY);
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
      storeIds: [],
      allStores: true,
      sharedStock: p.shared_stock,
      imageUrl: p.image_url ?? '',
      showOnline: p.show_online,
      isActive: p.is_active,
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
    const price = Number(form.unitPrice);
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
          brand: form.brand.trim(),
          ivaCode: form.ivaCode,
          unitPrice: price,
          costPrice: Number(form.costPrice) || 0,
          imageUrl: form.imageUrl || undefined,
          showOnline: form.showOnline,
          sharedStock: form.sharedStock,
          isActive: form.isActive,
        });
      } else {
        // Código de barras OPCIONAL — vazio: o sistema gera um EAN-13 interno.
        const payload: CreateProductInput = {
          code: form.code.trim() || undefined,
          barcode: form.code.trim() || undefined,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          brand: form.brand.trim() || undefined,
          ivaCode: form.ivaCode,
          unitPrice: price,
          costPrice: Number(form.costPrice) || 0,
          stockQty: Number(form.stockQty) || 0,
          sharedStock: form.sharedStock,
          imageUrl: form.imageUrl || undefined,
          showOnline: form.showOnline,
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

  return (
    <>
      <div className="content-head">
        <h2>Catálogo de produtos</h2>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => setEntering(true)} disabled={stores.length === 0 || products.length === 0}>
          <IconTruck size={16} /> Entrada de stock
        </button>
        <button className="btn" onClick={openCreate}>
          <IconPlus size={18} /> Novo produto
        </button>
      </div>

      <div className="card" style={{ padding: '2px 14px' }}>
        <div className="row">
          <IconSearch size={18} />
          <input
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '13px 0', color: 'var(--text)' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Procurar por nome ou código…"
          />
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
          <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>
            O <strong>preço de venda</strong>, o <strong>custo</strong> e o <strong>stock</strong> definem-se no botão <strong>Entrada de stock</strong> (aqui em cima) ao dar entrada de mercadoria.
          </p>
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
            <span>Mostrar na loja online</span>
            <Switch checked={form.showOnline} onChange={(v) => setForm({ ...form, showOnline: v })} />
          </div>
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
    </>
  );
}
