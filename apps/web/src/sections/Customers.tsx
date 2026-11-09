import React, { useEffect, useMemo, useState } from 'react';
import { isNativeApp } from '../config';
import { api, ApiError } from '../api/client';
import type { CustomerRow } from '../api/types';
import { confirmDialog, runBulk, toast } from '../components/feedback';
import { IconPlus, IconReceipt, IconSearch, IconTrash, IconTrendUp, IconUser, IconUsers } from '../components/Icons';
import { Modal } from '../components/ui';
import { takeQuickCreate } from '../components/TopStatus';
import { formatKz, formatDate } from '../format';
import { isNetworkError, queueCustomer } from '../offline/writes';

/** Contas rápidas da loja online sem email usam um endereço interno — não se mostra. */
const shownEmail = (e?: string | null): string => (e && !e.toLowerCase().endsWith('@sem-email.lps') ? e : '');

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
  const [state, setState] = useState<'ALL' | 'ON' | 'OFF'>('ALL');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const moreRef = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!more && !rowMenu) return;
    const h = (e: MouseEvent) => { const t = e.target as Node; if (moreRef.current?.contains(t) || rowRef.current?.contains(t)) return; setMore(false); setRowMenu(null); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [more, rowMenu]);
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
  // "+" da barra de topo → "Cliente": abre já o formulário.
  useEffect(() => { if (takeQuickCreate('customers')) openCreate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openEdit = (c: CustomerRow) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone ?? '', email: shownEmail(c.email), taxId: c.tax_id ?? '', address: c.address ?? '', province: c.province ?? '', municipality: c.municipality ?? '' });
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

  // Totais do SERVIDOR (todos os clientes); a lista pode estar paginada.
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.customers.stats>> | null>(null);
  useEffect(() => { api.customers.stats().then(setStats).catch(() => setStats(null)); }, [rows.length]);
  const totalSpent = useMemo(() => stats?.totalSpent ?? rows.reduce((s, r) => s + (r.total_spent ?? 0), 0), [rows, stats]);
  const withPurchases = useMemo(() => stats?.withPurchases ?? rows.filter((r) => (r.purchases ?? 0) > 0).length, [rows, stats]);

  const avgTicket = useMemo(() => {
    const n = stats?.purchases ?? rows.reduce((s, r) => s + (r.purchases ?? 0), 0);
    return n > 0 ? totalSpent / n : 0;
  }, [rows, totalSpent, stats]);

  // ── Listagem no padrão de referência: Todos/Ativo/Inativo, Pesquisar, tabela
  // Nome | NIF | Localidade | Telemóvel | Compras | Estado | Opções, 20 por página. ──
  const shownRows = filtered.filter((c) => (state === 'ALL' ? true : state === 'ON' ? c.is_active : !c.is_active));
  const perPage = 20;
  const pageCount = Math.max(1, Math.ceil(shownRows.length / perPage));
  const cur = Math.min(page, pageCount);
  const pageRows = shownRows.slice((cur - 1) * perPage, cur * perPage);
  const pageSel = pageRows.length > 0 && pageRows.every((c) => selected.has(c.id));
  const togglePage = () => setSelected((p) => { const n = new Set(p); if (pageSel) pageRows.forEach((c) => n.delete(c.id)); else pageRows.forEach((c) => n.add(c.id)); return n; });
  const waLink = (phone: string) => `https://wa.me/${phone.replace(/[^\d]/g, '').replace(/^(?!244)(\d{9})$/, '244$1')}`;

  /** Exportar clientes (CSV com o filtro atual), como no backoffice de referência. */
  const exportCsv = () => {
    const esc = (v: unknown) => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Nome', 'NIF', 'Telemóvel', 'E-mail', 'Morada', 'Município', 'Província'];
    const lines = filtered.map((c) => [c.name, c.tax_id ?? '', c.phone ?? '', shownEmail(c.email), c.address ?? '', c.municipality ?? '', c.province ?? ''].map(esc).join(';'));
    const blob = new Blob(['\ufeff' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Clientes</span><span className="sep">/</span><span>Listagem</span></p>
        <span className="spacer" />
        <button className="vd-btn" onClick={openCreate}><IconPlus size={16} /> Adicionar Cliente</button>
        <button className="vd-btn outline" onClick={exportCsv} disabled={filtered.length === 0}>Exportar Clientes</button>
        <div className="vd-split" ref={moreRef}>
          <button className="vd-btn outline" onClick={() => setMore((v) => !v)} aria-expanded={more}>Opções ▾</button>
          {more ? (
            <div className="vd-drop" role="menu">
              <button role="menuitem" onClick={() => { setMore(false); toggleAll(); }} disabled={filtered.length === 0}>{allSel ? 'Desmarcar todos' : 'Selecionar todos'}</button>
              <hr />
              <button role="menuitem" className="danger" onClick={() => { setMore(false); void bulkDelete(); }} disabled={selected.size === 0 || bulkBusy}>Eliminar selecionados ({selected.size})</button>
            </div>
          ) : null}
        </div>
      </div>

      <form className="vd-card vd-filters" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <div className="vd-seg" role="tablist" aria-label="Estado">
            {([['ALL', 'Todos'], ['ON', 'Ativo'], ['OFF', 'Inativo']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={state === k} className={state === k ? 'on' : ''} onClick={() => { setState(k); setPage(1); }}>{l}</button>
            ))}
          </div>
          <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar por nome, NIF, telefone ou e-mail" aria-label="Procurar clientes" /></label>
          <button type="submit" className="vd-btn outline"><IconSearch size={15} /> Pesquisar</button>
        </div>
      </form>

      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="vd-card vd-tablecard">
        <div className="vd-tbar">
          <span>{shownRows.length.toLocaleString('pt-PT')}{hasMore ? '+' : ''} registos</span>
          <span className="spacer" />
          <div className="vd-sum">
            <span>Clientes <b>{stats?.total ?? rows.length}</b></span>
            <span>Já compraram <b>{withPurchases}</b></span>
            <span>Faturado <b>{formatKz(totalSpent)}</b></span>
            <span>Compra média <b>{formatKz(avgTicket)}</b></span>
          </div>
        </div>
        {selected.size > 0 ? (
          <div className="vd-bulk"><strong>{selected.size} selecionado(s)</strong><span className="spacer" />
            <button className="vd-btn plain sm" onClick={() => setSelected(new Set())} disabled={bulkBusy}>Limpar</button>
            <button className="vd-btn danger sm" onClick={() => void bulkDelete()} disabled={bulkBusy}>Eliminar</button></div>
        ) : null}
        {loading ? <div className="loading">A carregar…</div> : pageRows.length === 0 ? (
          <div className="vd-empty">{q || state !== 'ALL' ? 'Sem resultados.' : 'Ainda não há clientes.'}</div>
        ) : (
          <div className="vd-tablewrap">
            <table className="vd-table">
              <thead><tr>
                <th className="chk"><input type="checkbox" checked={pageSel} onChange={togglePage} aria-label="Selecionar a página" /></th>
                <th>Nome</th><th>NIF</th><th>Localidade</th><th>Telemóvel</th><th className="num">Compras</th><th className="ctr">Estado</th><th aria-label="Opções" />
              </tr></thead>
              <tbody>
                {pageRows.map((c, i) => (
                  <tr key={c.id} className={`${selected.has(c.id) ? 'sel' : ''}${!c.is_active ? ' off' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}>
                    <td className="chk"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} aria-label={`Selecionar ${c.name}`} /></td>
                    <td><button className="vd-link" onClick={() => openEdit(c)}>{c.name}</button>{shownEmail(c.email) ? <span className="sub">{shownEmail(c.email)}</span> : null}</td>
                    <td>{c.tax_id || '—'}</td>
                    <td>{[c.municipality, c.province].filter(Boolean).join(', ') || '—'}</td>
                    <td>{c.phone || '—'}</td>
                    <td className="num">{(c.purchases ?? 0) > 0 ? <>{formatKz(c.total_spent ?? 0)}<span className="sub">{c.purchases} compra(s){c.last_purchase ? ` · ${formatDate(c.last_purchase)}` : ''}</span></> : '—'}</td>
                    <td className="ctr"><span className={`vd-badge${c.is_active ? '' : ' mute'}`}>{c.is_active ? 'Ativo' : 'Inativo'}</span></td>
                    <td className="num">
                      <div className="vd-opts" ref={rowMenu === c.id ? rowRef : undefined}>
                        <button className="vd-btn plain" aria-expanded={rowMenu === c.id} onClick={() => setRowMenu((m) => (m === c.id ? null : c.id))}>Opções ▾</button>
                        {rowMenu === c.id ? (
                          <div className="vd-drop" role="menu">
                            <button role="menuitem" onClick={() => { setRowMenu(null); openEdit(c); }}>Editar</button>
                            {c.phone ? <button role="menuitem" onClick={() => { setRowMenu(null); window.open(waLink(c.phone!), '_blank', 'noopener'); }}>WhatsApp</button> : null}
                            {c.phone ? <button role="menuitem" onClick={() => { setRowMenu(null); window.location.href = `tel:${c.phone}`; }}>Ligar</button> : null}
                            <hr />
                            <button role="menuitem" className="danger" onClick={() => { setRowMenu(null); void remove(c); }}>Eliminar</button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && shownRows.length > 0 ? (
          <div className="vd-foot">
            <span>Página {cur} de {pageCount}</span>
            <span className="spacer" />
            {hasMore ? <button className="vd-btn outline sm" onClick={loadMore}>Carregar mais do servidor</button> : null}
            {pageCount > 1 ? (
              <div className="vd-pager">
                <button onClick={() => setPage(cur - 1)} disabled={cur <= 1}>Anterior</button>
                <button className="on">{cur}</button>
                <button onClick={() => setPage(cur + 1)} disabled={cur >= pageCount}>Seguinte</button>
              </div>
            ) : null}
          </div>
        ) : null}
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
    </div>
  );
}
