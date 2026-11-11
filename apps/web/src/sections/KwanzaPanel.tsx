import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { confirmDialog, readFileProgress } from '../components/feedback';
import { Modal, Switch } from '../components/ui';
import { STORE_URL } from '../config';
import { useAuth } from '../auth/AuthContext';
import { AffiliatesCard, BannersCard, MembersCard } from './StoreMarketing';

const kz = (n: number | string) => `${Number(n).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-PT') : '—');

interface KProduct { code: string; name: string; imageUrl: string | null; published: boolean; percent: number | null; mode: 'OPEN' | 'RESTRICTED'; allowMarkup: boolean; maxMarkupPct: number | null; materials: string[] }
interface KRequest { id: string; status: string; productCode: string; product: string | null; associate: string; phone: string; photoUrl: string | null; note: string | null; commissionPct: number | null; basePct: number; markupPct: number | null; date: string }
interface KAssociate { id: string; name: string; phone: string; code: string; photoUrl: string | null; sales: number; pending: number; available: number; paid: number; requested: number; balance: number }
interface KSale { orderNumber: string; product: string; quantity: number; amount: number; associate: string; code: string; date: string }
interface KWithdrawal { id: string; name: string; amount: number; method: string; details: string | null; status: string; note: string | null; proofUrl: string | null; date: string }

const ST: Record<string, string> = { PENDING: 'Pendente', APPROVED: 'Aprovada', REJECTED: 'Recusada', REQUESTED: 'Em análise', PAID: 'Pago' };

/**
 * LPS Kwanza dentro de Loja & Marca: o marketplace central (produtos publicados, pedidos de afiliação,
 * associados, vendas e saques) e a loja de associados da própria empresa.
 */
export function KwanzaPanel() {
  const auth = useAuth();
  const [area, setArea] = useState<'market' | 'own'>('market');
  const [tab, setTab] = useState<'products' | 'requests' | 'associates' | 'sales' | 'withdrawals'>('products');
  const companyCode = auth.companyCode ?? '';
  const base = STORE_URL.replace(/\/$/, '');
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>LPS Kwanza</h3>
        <button className={`btn sm${area === 'market' ? '' : ' ghost'}`} onClick={() => setArea('market')}>Marketplace central</button>
        <button className={`btn sm${area === 'own' ? '' : ' ghost'}`} onClick={() => setArea('own')}>Loja de associados da empresa</button>
      </div>
      {area === 'market' ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a className="btn sm ghost" href={`${base}/kwanza`} target="_blank" rel="noopener noreferrer">Abrir o marketplace</a>
            {([['products', 'Produtos'], ['requests', 'Pedidos de afiliação'], ['associates', 'Associados'], ['sales', 'Vendas por associados'], ['withdrawals', 'Saques']] as const).map(([k, l]) => (
              <button key={k} className={`btn sm${tab === k ? '' : ' ghost'}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'products' ? <Products /> : tab === 'requests' ? <Requests /> : tab === 'associates' ? <Associates /> : tab === 'sales' ? <Sales /> : <Withdrawals />}
        </>
      ) : (
        <>
          {companyCode ? <a className="btn sm ghost" style={{ justifySelf: 'start' }} href={`${base}/${companyCode}/associados`} target="_blank" rel="noopener noreferrer">Abrir a loja de associados</a> : null}
          <MembersCard />
          <BannersCard />
          <AffiliatesCard />
        </>
      )}
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

function Products() {
  const [q, setQ] = useState('');
  const { data, error, load, setError } = useLoad(() => api.kwanza.products(q || undefined) as Promise<KProduct[]>, [q]);
  const [edit, setEdit] = useState<KProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const sync = async () => { setBusy(true); try { await api.kwanza.sync(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Falhou.'); } finally { setBusy(false); } };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <input style={{ flex: 1 }} placeholder="Procurar produto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar produto" />
        <button className="btn sm ghost" disabled={busy} onClick={() => void sync()}>{busy ? 'A atualizar…' : 'Atualizar preços e stock'}</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}
      {!data ? <div className="loading">A carregar…</div> : !data.length ? <div className="empty"><p>Sem produtos.</p></div> : (
        <div className="table-wrap"><table className="vd-table">
          <thead><tr><th>Produto</th><th>No marketplace</th><th>Comissão</th><th>Afiliação</th><th>Preço próprio</th><th /></tr></thead>
          <tbody>{data.map((p) => (
            <tr key={p.code}>
              <td className="wrap"><strong>{p.name}</strong><div className="muted">{p.code}</div></td>
              <td>{p.published ? 'Publicado' : '—'}</td>
              <td>{p.percent ? `${p.percent}%` : '—'}</td>
              <td>{p.mode === 'RESTRICTED' ? 'Restrita' : 'Aberta'}</td>
              <td>{p.allowMarkup ? `até ${p.maxMarkupPct ?? 100}%` : '—'}</td>
              <td><button className="btn sm" onClick={() => setEdit(p)}>Configurar</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit ? <ProductEditor p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} /> : null}
    </div>
  );
}

function ProductEditor({ p, onClose, onSaved }: { p: KProduct; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState({ published: p.published, percent: p.percent == null ? '' : String(p.percent), mode: p.mode, allowMarkup: p.allowMarkup, maxMarkupPct: p.maxMarkupPct == null ? '' : String(p.maxMarkupPct), materials: p.materials.join('\n') });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.kwanza.saveProduct(p.code, {
        published: f.published, percent: f.percent ? Number(f.percent.replace(',', '.')) : null, mode: f.mode,
        allowMarkup: f.allowMarkup, maxMarkupPct: f.maxMarkupPct ? Number(f.maxMarkupPct.replace(',', '.')) : null,
        materials: f.materials.split(/\s+/).map((x) => x.trim()).filter(Boolean),
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); } finally { setBusy(false); }
  };
  return (
    <Modal title={p.name} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="switch-row"><strong>Publicar no LPS Kwanza</strong><Switch checked={f.published} onChange={(v) => setF({ ...f, published: v })} /></div>
        <label className="field"><span>Comissão do associado (%)</span><input inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></label>
        <label className="field"><span>Afiliação</span>
          <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'OPEN' | 'RESTRICTED' })}><option value="OPEN">Aberta (qualquer associado)</option><option value="RESTRICTED">Restrita (a empresa aprova)</option></select></label>
        <div className="switch-row"><strong>Venda no teu preço</strong><Switch checked={f.allowMarkup} onChange={(v) => setF({ ...f, allowMarkup: v })} /></div>
        {f.allowMarkup ? <label className="field"><span>Acréscimo máximo (%)</span><input inputMode="decimal" value={f.maxMarkupPct} onChange={(e) => setF({ ...f, maxMarkupPct: e.target.value })} /></label> : null}
        <label className="field"><span>Materiais de divulgação (uma ligação por linha)</span><textarea rows={3} value={f.materials} onChange={(e) => setF({ ...f, materials: e.target.value })} /></label>
        <button className="btn block" disabled={busy} onClick={() => void save()}>{busy ? 'A guardar…' : 'Guardar'}</button>
      </div>
    </Modal>
  );
}

function Requests() {
  const { data, error, load, setError } = useLoad(() => api.kwanza.requests() as Promise<KRequest[]>);
  const [pct, setPct] = useState<Record<string, string>>({});
  const decide = async (r: KRequest, status?: 'APPROVED' | 'REJECTED') => {
    const raw = pct[r.id];
    try { await api.kwanza.decide(r.id, { status, commissionPct: raw === undefined ? undefined : raw === '' ? null : Number(raw.replace(',', '.')) }); setPct((x) => { const n = { ...x }; delete n[r.id]; return n; }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível.'); }
  };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {error ? <div className="banner danger">{error}</div> : null}
      {!data ? <div className="loading">A carregar…</div> : !data.length ? <div className="empty"><p>Sem pedidos.</p></div> : (
        <div className="table-wrap"><table className="vd-table">
          <thead><tr><th>Associado</th><th>Produto</th><th>Data</th><th>Estado</th><th>% negociada</th><th /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td><strong>{r.associate}</strong><div className="muted">{r.phone}</div>{r.note ? <div className="muted wrap">“{r.note}”</div> : null}</td>
              <td className="wrap">{r.product ?? r.productCode}<div className="muted">base {r.basePct}%{r.markupPct ? ` · preço próprio +${r.markupPct}%` : ''}</div></td>
              <td>{dt(r.date)}</td><td>{ST[r.status] ?? r.status}</td>
              <td><input style={{ width: 80 }} inputMode="decimal" placeholder={String(r.basePct)} value={pct[r.id] ?? (r.commissionPct == null ? '' : String(r.commissionPct))} onChange={(e) => setPct({ ...pct, [r.id]: e.target.value })} aria-label="Comissão negociada" /></td>
              <td><div className="row" style={{ gap: 6 }}>
                {r.status !== 'APPROVED' ? <button className="btn sm" onClick={() => void decide(r, 'APPROVED')}>Aprovar</button> : null}
                {r.status === 'PENDING' ? <button className="btn sm ghost" onClick={() => void decide(r, 'REJECTED')}>Recusar</button> : null}
                {pct[r.id] !== undefined && r.status === 'APPROVED' ? <button className="btn sm ghost" onClick={() => void decide(r)}>Guardar %</button> : null}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Associates() {
  const { data, error } = useLoad(() => api.kwanza.associates() as Promise<KAssociate[]>);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {error ? <div className="banner danger">{error}</div> : null}
      {!data ? <div className="loading">A carregar…</div> : !data.length ? <div className="empty"><p>Ainda sem associados a vender os seus produtos.</p></div> : (
        <div className="table-wrap"><table className="vd-table">
          <thead><tr><th>Associado</th><th>Código</th><th>Vendas</th><th>Em processo</th><th>A pagar</th><th>Em análise</th><th>Pago</th></tr></thead>
          <tbody>{data.map((a) => <tr key={a.id}><td><strong>{a.name}</strong><div className="muted">{a.phone}</div></td><td>{a.code}</td><td>{a.sales}</td><td>{kz(a.pending)}</td><td><strong>{kz(a.balance)}</strong></td><td>{kz(a.requested)}</td><td>{kz(a.paid)}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Sales() {
  const { data, error } = useLoad(() => api.kwanza.sales() as Promise<KSale[]>);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {error ? <div className="banner danger">{error}</div> : null}
      {!data ? <div className="loading">A carregar…</div> : !data.length ? <div className="empty"><p>Sem vendas por associados.</p></div> : (
        <div className="table-wrap"><table className="vd-table">
          <thead><tr><th>Data</th><th>Encomenda</th><th>Produto</th><th>Associado</th><th>Comissão</th></tr></thead>
          <tbody>{data.map((s, i) => <tr key={`${s.orderNumber}-${i}`}><td>{dt(s.date)}</td><td><strong>{s.orderNumber}</strong></td><td className="wrap">{s.product} × {s.quantity}</td><td>{s.associate} <span className="muted">({s.code})</span></td><td>{kz(s.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Withdrawals() {
  const { data, error, load, setError } = useLoad(() => api.kwanza.withdrawals() as Promise<KWithdrawal[]>);
  const [paying, setPaying] = useState<KWithdrawal | null>(null);
  const reject = async (w: KWithdrawal) => {
    if (!(await confirmDialog({ message: `Recusar o saque de ${kz(w.amount)} a ${w.name}?`, danger: true }))) return;
    try { await api.kwanza.reject(w.id); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível.'); }
  };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {error ? <div className="banner danger">{error}</div> : null}
      {!data ? <div className="loading">A carregar…</div> : !data.length ? <div className="empty"><p>Sem pedidos de saque.</p></div> : (
        <div className="table-wrap"><table className="vd-table">
          <thead><tr><th>Data</th><th>Associado</th><th>Valor</th><th>Receber por</th><th>Estado</th><th /></tr></thead>
          <tbody>{data.map((w) => (
            <tr key={w.id}>
              <td>{dt(w.date)}</td><td><strong>{w.name}</strong></td><td>{kz(w.amount)}</td>
              <td className="wrap">{w.method}{w.details ? <div className="muted">{w.details}</div> : null}</td>
              <td>{ST[w.status] ?? w.status}{w.proofUrl ? <div><a href={w.proofUrl} target="_blank" rel="noopener noreferrer" download>Comprovativo</a></div> : null}</td>
              <td>{w.status === 'REQUESTED' ? <div className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => setPaying(w)}>Marcar como pago</button><button className="btn sm ghost" onClick={() => void reject(w)}>Recusar</button></div> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {paying ? <Pay w={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void load(); }} /> : null}
    </div>
  );
}

function Pay({ w, onClose, onDone }: { w: KWithdrawal; onClose(): void; onDone(): void }) {
  const [note, setNote] = useState(''); const [proof, setProof] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const pick = (file?: File) => { if (!file) return; if (file.size > 2_000_000) { setErr('Ficheiro demasiado grande (máx. ~2 MB).'); return; } void readFileProgress(file).then(setProof); };
  const save = async () => { setBusy(true); setErr(null); try { await api.kwanza.pay(w.id, note || undefined, proof || undefined); onDone(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); } finally { setBusy(false); } };
  return (
    <Modal title={`Pagar ${kz(w.amount)} a ${w.name}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="muted wrap">{w.method}{w.details ? ` · ${w.details}` : ''}</div>
        <label className="field"><span>Nota (opcional)</span><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="btn sm ghost" style={{ cursor: 'pointer', justifySelf: 'start' }}>{proof ? 'Trocar comprovativo' : 'Anexar comprovativo'}<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        {proof ? <span className="muted">Comprovativo anexado</span> : null}
        <button className="btn block" disabled={busy} onClick={() => void save()}>{busy ? 'A guardar…' : 'Marcar como pago'}</button>
      </div>
    </Modal>
  );
}
