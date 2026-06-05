import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CreateProductInput, IvaCode, ManagerProduct } from '../api/types';
import { IVA_RATE } from '../api/types';
import { IconCube, IconEdit, IconImage, IconPlus, IconSearch } from '../components/Icons';
import { Modal, Switch } from '../components/ui';
import { formatKz } from '../format';

const IVA_OPTIONS: IvaCode[] = ['NOR', 'RED', 'ISE', 'OUT'];

function grossUnit(p: ManagerProduct): number {
  return Number(p.unit_price) * (1 + IVA_RATE[p.iva_code] / 100);
}

interface FormState {
  code: string;
  name: string;
  description: string;
  ivaCode: IvaCode;
  exemptionReason: string;
  unitPrice: string;
  costPrice: string;
  stockQty: string;
  imageUrl: string;
  showOnline: boolean;
  isActive: boolean;
}

const EMPTY: FormState = {
  code: '',
  name: '',
  description: '',
  ivaCode: 'NOR',
  exemptionReason: '',
  unitPrice: '',
  costPrice: '',
  stockQty: '0',
  imageUrl: '',
  showOnline: true,
  isActive: true,
};

export function Products() {
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ManagerProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY);
    setFormError(null);
    setCreating(true);
  };

  const openEdit = (p: ManagerProduct) => {
    setForm({
      code: p.code,
      name: p.name,
      description: p.description ?? '',
      ivaCode: p.iva_code,
      exemptionReason: p.exemption_reason ?? '',
      unitPrice: p.unit_price,
      costPrice: p.cost_price ?? '',
      stockQty: p.stock_qty,
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
          ivaCode: form.ivaCode,
          exemptionReason: form.exemptionReason.trim(),
          unitPrice: price,
          costPrice: Number(form.costPrice) || 0,
          imageUrl: form.imageUrl || undefined,
          showOnline: form.showOnline,
          isActive: form.isActive,
        });
      } else {
        if (!form.code.trim()) {
          setFormError('Indique o código do produto.');
          setSaving(false);
          return;
        }
        const payload: CreateProductInput = {
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          ivaCode: form.ivaCode,
          exemptionReason: form.exemptionReason.trim(),
          unitPrice: price,
          costPrice: Number(form.costPrice) || 0,
          stockQty: Number(form.stockQty) || 0,
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
            <div className="pcard" key={p.id}>
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
              <label>Código</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ex.: CAFE-250" />
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
          <div className="grid-2">
            <div className="field">
              <label>Preço de venda (sem IVA)</label>
              <input value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} inputMode="decimal" placeholder="0" />
            </div>
            <div className="field">
              <label>Custo unitário (p/ lucro)</label>
              <input value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} inputMode="decimal" placeholder="0" />
            </div>
          </div>
          <div className="field">
            <label>IVA</label>
            <select value={form.ivaCode} onChange={(e) => setForm({ ...form, ivaCode: e.target.value as IvaCode })}>
              {IVA_OPTIONS.map((c) => (
                <option key={c} value={c}>{c} ({IVA_RATE[c]}%)</option>
              ))}
            </select>
          </div>
          {form.ivaCode === 'ISE' || form.ivaCode === 'OUT' ? (
            <div className="field">
              <label>Motivo de isenção (obrigatório na factura)</label>
              <input
                value={form.exemptionReason}
                onChange={(e) => setForm({ ...form, exemptionReason: e.target.value })}
                placeholder={form.ivaCode === 'ISE' ? 'ex.: Isento Artigo 12.º do CIVA' : 'ex.: Não sujeito a IVA'}
              />
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                Aparece no recibo. Se deixares vazio, usa-se um motivo padrão.
              </p>
            </div>
          ) : null}
          {editing ? (
            <div className="field">
              <label>Stock atual</label>
              <input value={form.stockQty} readOnly disabled />
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                Gerido em <strong>Inventário</strong> (entradas/acertos) — assim o stock por armazém fica sincronizado.
              </p>
            </div>
          ) : (
            <div className="field">
              <label>Stock inicial</label>
              <input value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} inputMode="numeric" placeholder="0" />
            </div>
          )}

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
    </>
  );
}
