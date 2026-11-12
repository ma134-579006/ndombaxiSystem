import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { confirmDialog, readFileProgress, toast } from '../components/feedback';
import { Modal, Switch } from '../components/ui';
import { STORE_URL } from '../config';
import { useAuth } from '../auth/AuthContext';
import { AffiliatesCard, BannersCard, MembersCard } from './StoreMarketing';

const kz = (n: number | string) => `${Number(n).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

interface KProduct { code: string; name: string; imageUrl: string | null; published: boolean; percent: number | null; mode: 'OPEN' | 'RESTRICTED'; allowMarkup: boolean; maxMarkupPct: number | null; materials: string[] }
interface KRequest { id: string; status: string; productCode: string; product: string | null; associate: string; phone: string; photoUrl: string | null; note: string | null; commissionPct: number | null; basePct: number; markupPct: number | null; date: string }
interface KAssociate { id: string; name: string; phone: string; code: string; photoUrl: string | null; sales: number; pending: number; available: number; paid: number; requested: number; balance: number }
interface KSale { orderNumber: string; product: string; quantity: number; amount: number; associate: string; code: string; date: string }
interface KWithdrawal { id: string; name: string; amount: number; method: string; details: string | null; status: string; note: string | null; proofUrl: string | null; date: string }
interface KChat { associateId: string; name: string; phone: string; photoUrl: string | null; last: string; at: string; unread: number }
interface KMsg { id: string; sender: 'ASSOCIATE' | 'COMPANY'; senderName: string; body: string; createdAt: string }

type Tab = 'products' | 'requests' | 'associates' | 'sales' | 'withdrawals' | 'chat' | 'own';
const TABS: Array<[Tab, string]> = [['products', 'Produtos'], ['requests', 'Pedidos'], ['associates', 'Associados'], ['sales', 'Vendas'], ['withdrawals', 'Saques'], ['chat', 'Mensagens'], ['own', 'Loja de associados']];
const ST: Record<string, [string, string]> = { PENDING: ['Pendente', 'warn'], APPROVED: ['Aprovada', ''], REJECTED: ['Recusada', 'mute'], REQUESTED: ['Por pagar', 'warn'], PAID: ['Pago', ''] };

/** LPS Kwanza — página própria no painel de cada empresa (marketplace central + loja de associados). */
export function Kwanza() {
  const { companyCode } = useAuth();
  const [tab, setTab] = useState<Tab>(() => { try { return (sessionStorage.getItem('ndombaxi.kwanza.tab') as Tab) || 'products'; } catch { return 'products'; } });
  const [stats, setStats] = useState<{ pub: number; req: number; assoc: number; pay: number; unread: number } | null>(null);
  const go = (t: Tab) => { setTab(t); try { sessionStorage.setItem('ndombaxi.kwanza.tab', t); } catch { /* */ } };
  const loadStats = useCallback(async () => {
    const [p, r, a, w, c] = await Promise.all([
      api.kwanza.products().catch(() => []) as Promise<KProduct[]>, api.kwanza.requests().catch(() => []) as Promise<KRequest[]>,
      api.kwanza.associates().catch(() => []) as Promise<KAssociate[]>, api.kwanza.withdrawals().catch(() => []) as Promise<KWithdrawal[]>,
      api.kwanza.chats().catch(() => []) as Promise<KChat[]>,
    ]);
    setStats({ pub: p.filter((x) => x.published).length, req: r.filter((x) => x.status === 'PENDING').length, assoc: a.length, pay: w.filter((x) => x.status === 'REQUESTED').reduce((s, x) => s + x.amount, 0), unread: c.reduce((s, x) => s + x.unread, 0) });
  }, []);
  useEffect(() => { void loadStats(); }, [loadStats, tab]);
  // Notificação com ligação direta (ref "requests", "withdrawals" ou "chat:<associado>") abre o separador certo.
  const [chatWith, setChatWith] = useState<string | null>(null);
  useEffect(() => {
    const apply = () => {
      try {
        const r = sessionStorage.getItem('ndombaxi.kwanza.ref'); if (!r) return;
        sessionStorage.removeItem('ndombaxi.kwanza.ref');
        if (r.startsWith('chat:')) { setChatWith(r.slice(5)); go('chat'); } else if (TABS.some((t) => t[0] === r)) go(r as Tab);
      } catch { /* sem armazenamento */ }
    };
    apply();
    window.addEventListener('ndombaxi:kwanza-ref', apply);
    return () => window.removeEventListener('ndombaxi:kwanza-ref', apply);
  }, []);
  const base = STORE_URL.replace(/\/$/, '');
  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>LPS Kwanza</span><span className="sep">/</span><span>{TABS.find((t) => t[0] === tab)?.[1]}</span></p>
        <span className="spacer" />
        <a className="vd-btn" href={`${base}/kwanza`} target="_blank" rel="noopener noreferrer">Abrir o marketplace</a>
        {companyCode ? <a className="vd-btn outline" href={`${base}/${companyCode}/associados`} target="_blank" rel="noopener noreferrer">Abrir a loja de associados</a> : null}
      </div>
      <div className="kz-kpis">
        <button className="vd-card kz-kpi" onClick={() => go('products')}><span>Produtos no marketplace</span><b>{stats?.pub ?? '—'}</b></button>
        <button className="vd-card kz-kpi" onClick={() => go('requests')}><span>Pedidos pendentes</span><b className={stats?.req ? 'warn' : ''}>{stats?.req ?? '—'}</b></button>
        <button className="vd-card kz-kpi" onClick={() => go('associates')}><span>Associados a vender</span><b>{stats?.assoc ?? '—'}</b></button>
        <button className="vd-card kz-kpi" onClick={() => go('withdrawals')}><span>Saques por pagar</span><b className={stats?.pay ? 'warn' : ''}>{stats ? kz(stats.pay) : '—'}</b></button>
      </div>
      <div className="vd-card vd-filters">
        <div className="vd-seg kz-seg" role="tablist" aria-label="LPS Kwanza">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{l}{k === 'requests' && stats?.req ? <i className="kz-dot">{stats.req}</i> : null}{k === 'chat' && stats?.unread ? <i className="kz-dot">{stats.unread}</i> : null}</button>)}
        </div>
      </div>
      {tab === 'products' ? <Products onChange={loadStats} /> : tab === 'requests' ? <Requests onChange={loadStats} /> : tab === 'associates' ? <Associates onChat={(id) => { setChatWith(id); go('chat'); }} />
        : tab === 'sales' ? <Sales /> : tab === 'withdrawals' ? <Withdrawals onChange={loadStats} /> : tab === 'chat' ? <Chats key={chatWith ?? ''} initial={chatWith} onChange={loadStats} />
        : <div className="kz-own"><MembersCard /><BannersCard /><AffiliatesCard /></div>}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await fn()); setError(null); } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); } }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  return { data, error, load, setError };
}
const Empty = ({ t }: { t: string }) => <div className="vd-empty">{t}</div>;

/* ── produtos ── */
function Products({ onChange }: { onChange(): void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pub' | 'off'>('all');
  const { data, error, load, setError } = useLoad(() => api.kwanza.products(q || undefined) as Promise<KProduct[]>, [q]);
  const [edit, setEdit] = useState<KProduct | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (data ?? []).filter((p) => filter === 'all' || (filter === 'pub' ? p.published : !p.published)), [data, filter]);
  const sync = async () => { setBusy(true); try { await api.kwanza.sync(); await load(); toast.success('Preços e stock atualizados'); } catch (e) { setError(e instanceof ApiError ? e.message : 'Falhou.'); } finally { setBusy(false); } };
  const unpublish = async () => {
    if (!(await confirmDialog({ message: `Retirar ${sel.size} produto(s) do marketplace?` }))) return;
    setBusy(true);
    for (const code of sel) { const p = data?.find((x) => x.code === code); if (p) await api.kwanza.saveProduct(code, { ...p, published: false }).catch(() => undefined); }
    setSel(new Set()); setBusy(false); await load(); onChange();
  };
  const toggle = (code: string) => setSel((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  return (
    <>
      <form className="vd-card vd-filters" onSubmit={(e) => e.preventDefault()}>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <div className="vd-seg" role="tablist" aria-label="Estado">
            {([['all', 'Todos'], ['pub', 'Publicados'], ['off', 'Não publicados']] as const).map(([k, l]) => <button type="button" key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar por nome ou código" aria-label="Pesquisar produtos" /></label>
          <button type="button" className="vd-btn outline" disabled={busy} onClick={() => void sync()}>{busy ? 'A atualizar…' : 'Atualizar preços e stock'}</button>
        </div>
      </form>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}
      <div className="vd-card vd-tablecard">
        {sel.size ? <div className="vd-bulk"><strong>{sel.size} selecionado(s)</strong><span className="spacer" /><button className="vd-btn plain sm" onClick={() => setSel(new Set())}>Limpar</button><button className="vd-btn danger sm" disabled={busy} onClick={() => void unpublish()}>Retirar do marketplace</button></div> : null}
        {!data ? <div className="vd-empty">A carregar…</div> : !rows.length ? <Empty t="Sem produtos." /> : (
          <div className="vd-tablewrap"><table className="vd-table">
            <thead><tr><th className="ctr"><input type="checkbox" aria-label="Selecionar todos" checked={rows.length > 0 && rows.every((r) => sel.has(r.code))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.code)) : new Set())} /></th><th>Produto</th><th className="ctr">Marketplace</th><th className="ctr">Comissão</th><th className="ctr">Afiliação</th><th className="ctr">Preço próprio</th><th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.code}>
                <td className="ctr"><input type="checkbox" checked={sel.has(p.code)} onChange={() => toggle(p.code)} aria-label={`Selecionar ${p.name}`} /></td>
                <td><div className="kz-prod">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="kz-noimg" />}<div><button className="vd-link" onClick={() => setEdit(p)}>{p.name}</button><span className="sub">{p.code}</span></div></div></td>
                <td className="ctr"><span className={`vd-badge${p.published ? '' : ' mute'}`}>{p.published ? 'Publicado' : 'Não publicado'}</span></td>
                <td className="ctr">{p.percent ? `${p.percent}%` : '—'}</td>
                <td className="ctr">{p.mode === 'RESTRICTED' ? <span className="vd-badge warn">Restrita</span> : 'Aberta'}</td>
                <td className="ctr">{p.allowMarkup ? `até ${p.maxMarkupPct ?? 100}%` : '—'}</td>
                <td className="ctr"><button className="vd-btn outline sm" onClick={() => setEdit(p)}>Configurar</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {edit ? <ProductEditor p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); onChange(); }} /> : null}
    </>
  );
}

function ProductEditor({ p, onClose, onSaved }: { p: KProduct; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState({ published: p.published || !p.percent, percent: p.percent == null ? '' : String(p.percent), mode: p.mode, allowMarkup: p.allowMarkup, maxMarkupPct: p.maxMarkupPct == null ? '' : String(p.maxMarkupPct), materials: p.materials.join('\n') });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.kwanza.saveProduct(p.code, { published: f.published, percent: f.percent ? Number(f.percent.replace(',', '.')) : null, mode: f.mode, allowMarkup: f.allowMarkup, maxMarkupPct: f.maxMarkupPct ? Number(f.maxMarkupPct.replace(',', '.')) : null, materials: f.materials.split(/\s+/).map((x) => x.trim()).filter(Boolean) });
      toast.success(f.published ? 'Publicado no LPS Kwanza' : 'Guardado'); onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); } finally { setBusy(false); }
  };
  return (
    <Modal title={p.name} onClose={onClose}>
      {err ? <div className="vd-err" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div className="kz-form">
        <div className="switch-row"><strong>Publicar no LPS Kwanza</strong><Switch checked={f.published} onChange={(v) => setF({ ...f, published: v })} /></div>
        <label className="vd-f"><span>Comissão do associado (%)</span><input className="vd-in" inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></label>
        <label className="vd-f"><span>Afiliação</span><select className="vd-in" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'OPEN' | 'RESTRICTED' })}><option value="OPEN">Aberta (qualquer associado)</option><option value="RESTRICTED">Restrita (a empresa aprova)</option></select></label>
        <div className="switch-row"><strong>Venda no teu preço</strong><Switch checked={f.allowMarkup} onChange={(v) => setF({ ...f, allowMarkup: v })} /></div>
        {f.allowMarkup ? <label className="vd-f"><span>Acréscimo máximo (%)</span><input className="vd-in" inputMode="decimal" value={f.maxMarkupPct} onChange={(e) => setF({ ...f, maxMarkupPct: e.target.value })} /></label> : null}
        <label className="vd-f"><span>Materiais de divulgação (uma ligação por linha)</span><textarea className="vd-in" rows={3} value={f.materials} onChange={(e) => setF({ ...f, materials: e.target.value })} /></label>
        <button className="vd-btn" disabled={busy} onClick={() => void save()}>{busy ? 'A guardar…' : 'Guardar'}</button>
      </div>
    </Modal>
  );
}

/* ── pedidos de afiliação ── */
function Requests({ onChange }: { onChange(): void }) {
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const { data, error, load, setError } = useLoad(() => api.kwanza.requests() as Promise<KRequest[]>);
  const [pct, setPct] = useState<Record<string, string>>({});
  const rows = (data ?? []).filter((r) => filter === 'ALL' || r.status === 'PENDING');
  const decide = async (r: KRequest, status?: 'APPROVED' | 'REJECTED') => {
    const raw = pct[r.id];
    try { await api.kwanza.decide(r.id, { status, commissionPct: raw === undefined ? undefined : raw === '' ? null : Number(raw.replace(',', '.')) }); setPct((x) => { const n = { ...x }; delete n[r.id]; return n; }); toast.success(status === 'APPROVED' ? 'Afiliação aprovada' : status === 'REJECTED' ? 'Afiliação recusada' : 'Comissão negociada guardada'); await load(); onChange(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível.'); }
  };
  return (
    <>
      <div className="vd-card vd-filters"><div className="vd-seg">{([['PENDING', 'Pendentes'], ['ALL', 'Todos']] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
      {error ? <div className="vd-err">{error}</div> : null}
      <div className="vd-card vd-tablecard">
        {!data ? <div className="vd-empty">A carregar…</div> : !rows.length ? <Empty t={filter === 'PENDING' ? 'Sem pedidos pendentes.' : 'Sem pedidos.'} /> : (
          <div className="vd-tablewrap"><table className="vd-table">
            <thead><tr><th>Associado</th><th>Produto</th><th>Data</th><th className="ctr">Estado</th><th className="ctr">% negociada</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><div className="kz-prod">{r.photoUrl ? <img src={r.photoUrl} alt="" className="round" /> : <span className="kz-av">{r.associate.slice(0, 1)}</span>}<div><strong>{r.associate}</strong><span className="sub">{r.phone}</span>{r.note ? <span className="sub">“{r.note}”</span> : null}</div></div></td>
                <td>{r.product ?? r.productCode}<span className="sub">base {r.basePct}%{r.markupPct ? ` · preço próprio +${r.markupPct}%` : ''}</span></td>
                <td>{dt(r.date)}</td>
                <td className="ctr"><span className={`vd-badge ${ST[r.status]?.[1] ?? ''}`}>{ST[r.status]?.[0] ?? r.status}</span></td>
                <td className="ctr"><input className="vd-in kz-pct" inputMode="decimal" placeholder={String(r.basePct)} value={pct[r.id] ?? (r.commissionPct == null ? '' : String(r.commissionPct))} onChange={(e) => setPct({ ...pct, [r.id]: e.target.value })} aria-label="Comissão negociada" /></td>
                <td className="ctr"><div className="kz-acts">
                  {r.status !== 'APPROVED' ? <button className="vd-btn sm" onClick={() => void decide(r, 'APPROVED')}>Aprovar</button> : null}
                  {r.status === 'PENDING' ? <button className="vd-btn danger sm" onClick={() => void decide(r, 'REJECTED')}>Recusar</button> : null}
                  {pct[r.id] !== undefined && r.status === 'APPROVED' ? <button className="vd-btn outline sm" onClick={() => void decide(r)}>Guardar %</button> : null}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

/* ── associados ── */
function Associates({ onChat }: { onChat(id: string): void }) {
  const { data, error } = useLoad(() => api.kwanza.associates() as Promise<KAssociate[]>);
  return (
    <>
      {error ? <div className="vd-err">{error}</div> : null}
      <div className="vd-card vd-tablecard">
        {!data ? <div className="vd-empty">A carregar…</div> : !data.length ? <Empty t="Ainda sem associados a vender os seus produtos." /> : (
          <div className="vd-tablewrap"><table className="vd-table">
            <thead><tr><th>Associado</th><th className="ctr">Código</th><th className="ctr">Vendas</th><th className="num">Em processo</th><th className="num">A pagar</th><th className="num">Por pagar (pedido)</th><th className="num">Pago</th><th /></tr></thead>
            <tbody>{data.map((a) => <tr key={a.id}><td><div className="kz-prod">{a.photoUrl ? <img src={a.photoUrl} alt="" className="round" /> : <span className="kz-av">{a.name.slice(0, 1)}</span>}<div><strong>{a.name}</strong><span className="sub">{a.phone}</span></div></div></td><td className="ctr">{a.code}</td><td className="ctr">{a.sales}</td><td className="num">{kz(a.pending)}</td><td className="num"><strong>{kz(a.balance)}</strong></td><td className="num">{kz(a.requested)}</td><td className="num">{kz(a.paid)}</td><td className="ctr"><button className="vd-btn outline sm" onClick={() => onChat(a.id)}>Mensagem</button></td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

/* ── vendas por associados ── */
function Sales() {
  const { data, error } = useLoad(() => api.kwanza.sales() as Promise<KSale[]>);
  const total = (data ?? []).reduce((s, x) => s + x.amount, 0);
  return (
    <>
      {error ? <div className="vd-err">{error}</div> : null}
      <div className="vd-card vd-tablecard">
        <div className="vd-tbar"><div className="vd-sum"><span>{data?.length ?? 0} linha(s)</span><span>Comissões: <strong>{kz(total)}</strong></span></div></div>
        {!data ? <div className="vd-empty">A carregar…</div> : !data.length ? <Empty t="Sem vendas por associados." /> : (
          <div className="vd-tablewrap"><table className="vd-table">
            <thead><tr><th>Data</th><th>Encomenda</th><th>Produto</th><th>Associado</th><th className="num">Comissão</th></tr></thead>
            <tbody>{data.map((s, i) => <tr key={`${s.orderNumber}-${i}`}><td>{dt(s.date)}</td><td><strong>{s.orderNumber}</strong></td><td>{s.product} × {s.quantity}</td><td>{s.associate}<span className="sub">{s.code}</span></td><td className="num">{kz(s.amount)}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

/* ── saques ── */
function Withdrawals({ onChange }: { onChange(): void }) {
  const { data, error, load, setError } = useLoad(() => api.kwanza.withdrawals() as Promise<KWithdrawal[]>);
  const [paying, setPaying] = useState<KWithdrawal | null>(null);
  const reject = async (w: KWithdrawal) => {
    if (!(await confirmDialog({ message: `Recusar o saque de ${kz(w.amount)} a ${w.name}?`, danger: true }))) return;
    try { await api.kwanza.reject(w.id); toast.success('Saque recusado'); await load(); onChange(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível.'); }
  };
  return (
    <>
      {error ? <div className="vd-err">{error}</div> : null}
      <div className="vd-card vd-tablecard">
        {!data ? <div className="vd-empty">A carregar…</div> : !data.length ? <Empty t="Sem pedidos de saque." /> : (
          <div className="vd-tablewrap"><table className="vd-table">
            <thead><tr><th>Data</th><th>Associado</th><th className="num">Valor</th><th>Receber por</th><th className="ctr">Estado</th><th /></tr></thead>
            <tbody>{data.map((w) => (
              <tr key={w.id}>
                <td>{dt(w.date)}</td><td><strong>{w.name}</strong></td><td className="num"><strong>{kz(w.amount)}</strong></td>
                <td>{w.method}{w.details ? <span className="sub">{w.details}</span> : null}{w.note ? <span className="sub">{w.note}</span> : null}</td>
                <td className="ctr"><span className={`vd-badge ${ST[w.status]?.[1] ?? 'mute'}`}>{ST[w.status]?.[0] ?? 'Recusado'}</span>{w.proofUrl ? <a className="vd-link sub" href={w.proofUrl} target="_blank" rel="noopener noreferrer" download>Comprovativo</a> : null}</td>
                <td className="ctr">{w.status === 'REQUESTED' ? <div className="kz-acts"><button className="vd-btn sm" onClick={() => setPaying(w)}>Marcar como pago</button><button className="vd-btn danger sm" onClick={() => void reject(w)}>Recusar</button></div> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {paying ? <Pay w={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); toast.success('Saque marcado como pago'); void load(); onChange(); }} /> : null}
    </>
  );
}

function Pay({ w, onClose, onDone }: { w: KWithdrawal; onClose(): void; onDone(): void }) {
  const [note, setNote] = useState(''); const [proof, setProof] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const pick = (file?: File) => { if (!file) return; if (file.size > 2_000_000) { setErr('Ficheiro demasiado grande (máx. ~2 MB).'); return; } void readFileProgress(file).then(setProof); };
  const save = async () => { setBusy(true); setErr(null); try { await api.kwanza.pay(w.id, note || undefined, proof || undefined); onDone(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); } finally { setBusy(false); } };
  return (
    <Modal title={`Pagar ${kz(w.amount)} a ${w.name}`} onClose={onClose}>
      {err ? <div className="vd-err" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div className="kz-form">
        <div className="vd-card kz-payto"><span>{w.method}</span><strong>{w.details ?? '—'}</strong></div>
        <label className="vd-f"><span>Nota (opcional)</span><input className="vd-in" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="vd-btn outline" style={{ cursor: 'pointer', justifySelf: 'start' }}>{proof ? 'Trocar comprovativo' : 'Anexar comprovativo'}<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        {proof ? <span className="vd-badge">Comprovativo anexado</span> : null}
        <button className="vd-btn" disabled={busy} onClick={() => void save()}>{busy ? 'A guardar…' : 'Marcar como pago'}</button>
      </div>
    </Modal>
  );
}

/* ── mensagens com associados ── */
function Chats({ initial, onChange }: { initial: string | null; onChange(): void }) {
  const { data, load } = useLoad(() => api.kwanza.chats() as Promise<KChat[]>);
  const [cur, setCur] = useState<string | null>(null);
  const [wanted] = useState(initial);
  const [msgs, setMsgs] = useState<KMsg[]>([]);
  const [text, setText] = useState('');
  const body = useRef<HTMLDivElement | null>(null);
  const open = useCallback(async (id: string) => { setCur(id); setMsgs((await api.kwanza.chat(id)) as KMsg[]); void load(); onChange(); }, [load, onChange]);
  useEffect(() => { if (cur) return; if (wanted) void open(wanted); else if (data?.length) void open(data[0].associateId); }, [data, cur, open, wanted]);
  useEffect(() => { if (!cur) return; const t = window.setInterval(() => { void api.kwanza.chat(cur).then((m) => setMsgs(m as KMsg[])).catch(() => undefined); }, 6000); return () => window.clearInterval(t); }, [cur]);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }); }, [msgs]);
  const send = async () => { if (!cur || !text.trim()) return; setMsgs((await api.kwanza.send(cur, text.trim())) as KMsg[]); setText(''); void load(); };
  const who = data?.find((c) => c.associateId === cur);
  return (
    <div className="vd-card kz-chat">
      <aside className="kz-chat-list">
        {!data ? <div className="vd-empty">A carregar…</div> : !data.length ? <Empty t="Sem conversas." /> : data.map((c) => (
          <button key={c.associateId} className={cur === c.associateId ? 'on' : ''} onClick={() => void open(c.associateId)}>
            {c.photoUrl ? <img src={c.photoUrl} alt="" /> : <span className="kz-av">{c.name.slice(0, 1)}</span>}
            <span className="kz-chat-who"><b>{c.name}</b><small>{c.last}</small></span>
            {c.unread ? <i className="kz-dot">{c.unread}</i> : null}
          </button>
        ))}
      </aside>
      <section className="kz-chat-main">
        {who ? <header><b>{who.name}</b><small>{who.phone}</small></header> : null}
        <div className="kz-chat-body" ref={body}>
          {msgs.map((m) => <div key={m.id} className={`kz-msg ${m.sender === 'COMPANY' ? 'me' : ''}`}><span>{m.body}</span><small>{dt(m.createdAt)}</small></div>)}
        </div>
        {cur ? <form className="kz-chat-comp" onSubmit={(e) => { e.preventDefault(); void send(); }}><input className="vd-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva a mensagem…" aria-label="Mensagem" /><button className="vd-btn" disabled={!text.trim()}>Enviar</button></form> : null}
      </section>
    </div>
  );
}
