import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CustomerRow } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { IconPlus, IconSearch, IconTrash } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz, formatDate } from '../format';

const EMPTY = { name: '', phone: '', email: '', taxId: '', address: '', province: '', municipality: '' };

/**
 * CLIENTES (SaaS ERP/POS): base ÚNICA partilhada com o caixa e a loja online.
 * Mostra estatísticas de compra (nº compras, total gasto, última compra),
 * permite criar, EDITAR e ELIMINAR, e contacto rápido (WhatsApp/chamada).
 */
export function Customers() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSel = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const load = async () => {
    setLoading(true);
    try { setRows(await api.customers.list()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar clientes.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setOpen(true); };
  const openEdit = (c: CustomerRow) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', taxId: c.tax_id ?? '', address: c.address ?? '', province: c.province ?? '', municipality: c.municipality ?? '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.warning('Indica o nome do cliente.'); return; }
    setSaving(true);
    const body = {
      name: form.name.trim(), phone: form.phone.trim() || undefined, email: form.email.trim() || undefined,
      taxId: form.taxId.trim() || undefined, address: form.address.trim() || undefined,
      province: form.province.trim() || undefined, municipality: form.municipality.trim() || undefined,
    };
    try {
      if (editing) { await api.customers.update(editing.id, body); toast.success('Cliente atualizado.'); }
      else { await api.customers.create(body); toast.success(`Cliente «${form.name.trim()}» criado.`); }
      setOpen(false);
      await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSaving(false); }
  };

  const remove = async (c: CustomerRow) => {
    if (!(await confirmDialog({ message: `Eliminar o cliente «${c.name}»?`, danger: true }))) return;
    try {
      const r = await api.customers.remove(c.id);
      toast.success(r.deleted ? 'Cliente eliminado.' : 'Cliente tem histórico — foi desativado.');
      await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível eliminar.'); }
  };

  const bulkDelete = async () => {
    if (!(await confirmDialog({ message: `Eliminar ${selected.size} cliente(s)? Os que têm faturas são apenas desativados.`, danger: true }))) return;
    setBulkBusy(true);
    try { for (const id of selected) await api.customers.remove(id); setSelected(new Set()); toast.success('Clientes processados.'); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível eliminar.'); }
    finally { setBulkBusy(false); }
  };

  const filtered = q.trim()
    ? rows.filter((r) => `${r.name} ${r.phone ?? ''} ${r.email ?? ''} ${r.tax_id ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;

  const allSel = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(filtered.map((c) => c.id)));

  const totalSpent = useMemo(() => rows.reduce((s, r) => s + (r.total_spent ?? 0), 0), [rows]);
  const withPurchases = useMemo(() => rows.filter((r) => (r.purchases ?? 0) > 0).length, [rows]);

  return (
    <>
      <div className="sticky-top">
        <div className="content-head">
          <h2>Clientes <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>· {rows.length} registados</span></h2>
          <span className="spacer" />
          <button className="btn" onClick={openCreate}><IconPlus size={17} /> Novo cliente</button>
        </div>

        <div className="card toolbar-sticky" style={{ padding: '2px 14px' }}>
          <div className="row">
            <IconSearch size={18} />
            <input
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '13px 0', color: 'var(--text)' }}
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar por nome, telefone, email ou NIF…"
            />
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
            <strong>{selected.size} selecionado(s)</strong>
            <span className="spacer" style={{ flex: 1 }} />
            <button className="btn sm danger" onClick={() => void bulkDelete()} disabled={bulkBusy}>Eliminar selecionados</button>
          </div>
        ) : null}
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">Clientes</div><div className="kpi-value">{rows.length}</div><div className="kpi-sub">{withPurchases} já compraram</div></div>
        <div className="kpi-card success"><div className="kpi-label">Faturado a clientes</div><div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(totalSpent)}</div><div className="kpi-sub">soma das compras identificadas</div></div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? <div className="loading" style={{ padding: 26 }}>A carregar…</div>
          : filtered.length === 0 ? <div className="empty" style={{ padding: 30 }}><p>{q ? 'Sem resultados.' : 'Ainda não há clientes — cria o primeiro ou regista-os no caixa durante a venda.'}</p></div>
          : <>
            <div className="list-row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todos" />
              <span className="muted" style={{ fontSize: 12.5 }}>Selecionar todos ({filtered.length})</span>
            </div>
            {filtered.map((c) => (
            <div key={c.id} className="list-row" style={{ padding: '12px 16px' }}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} aria-label={`Selecionar ${c.name}`} />
              <span className="fb-avatar">{c.name.slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{c.name}</strong>
                <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.phone, c.email, c.tax_id ? `NIF ${c.tax_id}` : null].filter(Boolean).join(' · ') || 'sem contactos'}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {(c.purchases ?? 0) > 0
                    ? <>🛒 {c.purchases} compra(s) · <strong style={{ color: 'var(--success)' }}>{formatKz(c.total_spent ?? 0)}</strong>{c.last_purchase ? ` · última ${formatDate(c.last_purchase)}` : ''}</>
                    : 'sem compras ainda'}
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {c.phone ? (
                  <a className="btn sm ghost" href={`https://wa.me/${c.phone.replace(/[^\d]/g, '').replace(/^(?!244)(\d{9})$/, '244$1')}`} target="_blank" rel="noreferrer">💬</a>
                ) : null}
                {c.phone ? <a className="btn sm ghost" href={`tel:${c.phone}`}>📞</a> : null}
                <button className="btn sm ghost" onClick={() => openEdit(c)}>Editar</button>
                <button className="btn sm ghost" onClick={() => void remove(c)} title="Eliminar"><IconTrash size={15} /></button>
              </div>
            </div>
          ))}
          </>}
      </div>

      {open ? (
        <Modal title={editing ? 'Editar cliente' : 'Novo cliente'} onClose={() => setOpen(false)}>
          <div className="field"><label>Nome</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do cliente" /></div>
          <div className="grid-2">
            <div className="field"><label>Telefone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+244 9xx xxx xxx" inputMode="tel" /></div>
            <div className="field"><label>NIF (opcional)</label>
              <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} placeholder="para factura com NIF" /></div>
          </div>
          <div className="field"><label>E-mail (opcional)</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="cliente@email.com" inputMode="email" /></div>
          <div className="field"><label>Morada (opcional)</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Rua, bairro" /></div>
          <div className="grid-2">
            <div className="field"><label>Província (opcional)</label>
              <input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} placeholder="ex.: Luanda" /></div>
            <div className="field"><label>Município (opcional)</label>
              <input value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value })} placeholder="ex.: Belas" /></div>
          </div>
          <button className="btn lg block" onClick={() => void save()} disabled={saving}>{saving ? 'A guardar…' : editing ? 'Guardar alterações' : 'Criar cliente'}</button>
        </Modal>
      ) : null}
    </>
  );
}
