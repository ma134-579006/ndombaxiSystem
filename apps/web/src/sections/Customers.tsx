import React, { useEffect, useMemo, useState } from 'react';
import { isNativeApp } from '../config';
import { api, ApiError } from '../api/client';
import type { CustomerRow } from '../api/types';
import { confirmDialog, runBulk, toast } from '../components/feedback';
import { IconPlus, IconReceipt, IconSearch, IconTrash, IconTrendUp, IconUser, IconUsers } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz, formatDate } from '../format';
import { isNetworkError, queueCustomer } from '../offline/writes';

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

  // Muitos clientes: páginas de 200 e pesquisa no servidor (ou na memória, sem rede).
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const qRef = React.useRef({ q: '', pages: 1 });
  qRef.current = { q: q.trim(), pages };
  const load = async () => {
    setLoading(true);
    try {
      const n = qRef.current.pages * 200;
      const r = await api.customers.list({ q: qRef.current.q, limit: n });
      setRows(r); setHasMore(r.length >= n); setError(null);
    }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar clientes.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const firstQ = React.useRef(true);
  useEffect(() => {
    if (firstQ.current) { firstQ.current = false; return; }
    const t = window.setTimeout(() => { setPages(1); qRef.current = { q: q.trim(), pages: 1 }; void load(); }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const loadMore = () => { const n = pages + 1; setPages(n); qRef.current = { q: q.trim(), pages: n }; void load(); };

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
    } catch (e) {
      // SEM REDE: em vez de perder o trabalho, o cliente fica em fila e sobe
      // sozinho quando a ligação voltar. Só para esta entidade — ver writes.ts:
      // uma fila genérica poria documentos fiscais em risco.
      if (isNativeApp() && isNetworkError(e)) {
        const queued = await queueCustomer(body, editing?.id);
        if (queued) {
          toast.success(editing
            ? 'Cliente atualizado (guardado no aparelho — sobe quando houver ligação).'
            : `Cliente «${form.name.trim()}» criado (guardado no aparelho — sobe quando houver ligação).`);
          setOpen(false);
          await load();
          return;
        }
      }
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    }
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
    try {
      const r = await runBulk({ title: 'A eliminar clientes', items: [...selected], run: ([id]) => api.customers.remove(id) });
      setSelected(new Set()); await load();
      if (r.failed) toast.error(`${r.failed} não puderam ser eliminados (${r.firstError}).`); else toast.success('Clientes processados.');
    }
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

  const avgTicket = useMemo(() => {
    const n = rows.reduce((s, r) => s + (r.purchases ?? 0), 0);
    return n > 0 ? totalSpent / n : 0;
  }, [rows, totalSpent]);

  return (
    <div className="fx-wide">
      <div className="content-head">
        <h2>Clientes</h2>
        <span className="spacer" />
        <button className="btn" onClick={openCreate}><IconPlus size={17} /> Novo cliente</button>
      </div>

      <div className="fx-stats">
        <div className="fx-stat"><span className="ic"><IconUsers size={20} /></span><div><div className="lb">Clientes</div><div className="vl">{rows.length}</div><div className="sb">{withPurchases} já compraram</div></div></div>
        <div className="fx-stat"><span className="ic"><IconReceipt size={20} /></span><div><div className="lb">Faturado a clientes</div><div className="vl">{formatKz(totalSpent)}</div><div className="sb">compras identificadas</div></div></div>
        <div className="fx-stat"><span className="ic"><IconTrendUp size={20} /></span><div><div className="lb">Compra média</div><div className="vl">{formatKz(avgTicket)}</div><div className="sb">por compra</div></div></div>
      </div>

      <div className="fx-toolbar">
        <label className="fx-search" style={{ maxWidth: 520 }}>
          <IconSearch size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar por nome, telefone, e-mail ou NIF…" aria-label="Procurar clientes" />
        </label>
        {selected.size > 0 ? (
          <div className="row" style={{ gap: 10 }}>
            <strong>{selected.size} selecionado(s)</strong>
            <button className="btn sm danger" onClick={() => void bulkDelete()} disabled={bulkBusy}>Eliminar selecionados</button>
          </div>
        ) : null}
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      <div className="fx-card" style={{ padding: 8 }}>
        {loading ? <div className="loading" style={{ padding: 26 }}>A carregar…</div>
          : filtered.length === 0 ? <div className="empty" style={{ padding: 30 }}><p>{q ? 'Sem resultados.' : 'Ainda não há clientes — cria o primeiro ou regista-os no caixa durante a venda.'}</p></div>
          : <>
            <label className="row" style={{ padding: '8px 14px', gap: 10, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todos" /> Selecionar todos ({filtered.length})
            </label>
            {filtered.map((c) => (
              <div key={c.id} className="co-row">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} aria-label={`Selecionar ${c.name}`} />
                <span className="co-av" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
                <div className="co-main">
                  <div className="co-name">{c.name}</div>
                  <div className="co-meta">
                    {[c.phone, c.email, c.tax_id ? `NIF ${c.tax_id}` : null].filter(Boolean).map((x) => <span key={String(x)}>{x}</span>)}
                    {!c.phone && !c.email && !c.tax_id ? <span>sem contactos</span> : null}
                  </div>
                  <div className="co-state">
                    {(c.purchases ?? 0) > 0
                      ? <><span className="fx-dot ok" />{c.purchases} compra(s) · <strong style={{ marginLeft: 4, color: 'var(--text)' }}>{formatKz(c.total_spent ?? 0)}</strong>{c.last_purchase ? ` · última ${formatDate(c.last_purchase)}` : ''}</>
                      : <><span className="fx-dot" />sem compras ainda</>}
                  </div>
                </div>
                <div className="co-actions">
                  {c.phone ? (
                    <a className="btn sm ghost" href={`https://wa.me/${c.phone.replace(/[^\d]/g, '').replace(/^(?!244)(\d{9})$/, '244$1')}`} target="_blank" rel="noreferrer">WhatsApp</a>
                  ) : null}
                  {c.phone ? <a className="btn sm ghost" href={`tel:${c.phone}`}>Ligar</a> : null}
                  <button className="btn sm ghost" onClick={() => openEdit(c)}>Editar</button>
                  <button className="btn sm ghost" onClick={() => void remove(c)} title="Eliminar" aria-label={`Eliminar ${c.name}`}><IconTrash size={15} /></button>
                </div>
              </div>
            ))}
          </>}
      </div>
      {!loading && hasMore ? (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
          <button className="btn" onClick={loadMore}>Carregar mais clientes ({rows.length} mostrados)</button>
        </div>
      ) : null}

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
    </div>
  );
}
