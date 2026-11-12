import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { toast } from '../components/feedback';
import { Modal } from '../components/ui';

/** LPS Kwanza (painel) — reclamações, avaliações, política de devolução e congelamento de saldo. */
export interface KComplaint { id: string; code: string; kind: string; body: string; status: 'OPEN' | 'ANSWERED' | 'RESOLVED'; reply: string | null; name: string; phone: string; orderNumber: string | null; productCode: string | null; product: string | null; associateCode: string | null; associate: string | null; date: string }
export interface KReview { id: string; productCode: string; product: string | null; name: string; phone: string; rating: number; comment: string | null; reply: string | null; hidden: boolean; date: string }
export interface KFreeze { associateId: string; reason: string; date: string }

const KIND: Record<string, string> = { NOT_RECEIVED: 'Não recebeu', DAMAGED: 'Danificado', NOT_AS_DESCRIBED: 'Diferente do anunciado', REFUND: 'Devolução / reembolso', SELLER: 'Vendedor', OTHER: 'Outro' };
const ST: Record<string, [string, string]> = { OPEN: ['Por responder', 'warn'], ANSWERED: ['Respondida', ''], RESOLVED: ['Resolvida', 'ok'] };
const dt = (iso: string) => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Lista que se volta a ler sozinha (tempo real). */
function useLive<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await fn()); setError(null); } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10_000);
    return () => window.clearInterval(t);
  }, [load]);
  return { data, error, load, setError };
}

export function Complaints({ onChange, onFreeze }: { onChange(): void; onFreeze(associateCode: string): void }) {
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const { data, error, load } = useLive(() => api.kwanza.complaints() as Promise<KComplaint[]>);
  const [cur, setCur] = useState<KComplaint | null>(null);
  const rows = (data ?? []).filter((c) => filter === 'ALL' || c.status !== 'RESOLVED');
  return (
    <>
      <div className="vd-card vd-filters"><div className="vd-frow"><div className="vd-seg" role="tablist" aria-label="Estado">
        {([['OPEN', 'Em aberto'], ['ALL', 'Todas']] as const).map(([k, l]) => <button type="button" key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
      </div></div></div>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}
      <div className="vd-card vd-tablecard">
        {!data ? <div className="vd-empty">A carregar…</div> : !rows.length ? <div className="vd-empty">Sem reclamações.</div> : (
          <div className="vd-tablewrap"><table className="vd-table">
            <thead><tr><th>Código</th><th>Cliente</th><th>Motivo</th><th>Produto</th><th>Associado</th><th className="ctr">Estado</th><th>Data</th><th /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td><button className="vd-link" onClick={() => setCur(c)}>{c.code}</button></td>
                <td><strong>{c.name}</strong><span className="sub">{c.phone}</span></td>
                <td>{KIND[c.kind] ?? c.kind}{c.orderNumber ? <span className="sub">{c.orderNumber}</span> : null}</td>
                <td>{c.product ?? c.productCode ?? '—'}</td>
                <td>{c.associate ?? '—'}{c.associateCode ? <span className="sub">{c.associateCode}</span> : null}</td>
                <td className="ctr"><span className={`vd-badge ${ST[c.status]?.[1] ?? ''}`} style={{ whiteSpace: 'nowrap' }}>{ST[c.status]?.[0] ?? c.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{dt(c.date)}</td>
                <td className="ctr"><button className="vd-btn outline sm" onClick={() => setCur(c)}>{c.status === 'OPEN' ? 'Responder' : 'Abrir'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {cur ? <ComplaintEditor c={cur} onClose={() => setCur(null)} onFreeze={cur.associateCode ? () => { setCur(null); onFreeze(cur.associateCode!); } : undefined} onSaved={() => { setCur(null); void load(); onChange(); }} /> : null}
    </>
  );
}

function ComplaintEditor({ c, onClose, onSaved, onFreeze }: { c: KComplaint; onClose(): void; onSaved(): void; onFreeze?(): void }) {
  const [reply, setReply] = useState(c.reply ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async (status?: 'RESOLVED' | 'OPEN') => {
    setBusy(true); setErr(null);
    try { await api.kwanza.answerComplaint(c.id, { reply, ...(status ? { status } : {}) }); toast.success(status === 'RESOLVED' ? 'Reclamação resolvida' : 'Resposta enviada'); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Reclamação ${c.code}`} onClose={onClose}>
      {err ? <div className="vd-err" style={{ marginBottom: 10 }} role="alert">{err}</div> : null}
      <div className="kz-form">
        <div className="kz-claim">
          <div><strong>{c.name}</strong> · {c.phone}</div>
          <div className="sub">{KIND[c.kind] ?? c.kind}{c.orderNumber ? ` · ${c.orderNumber}` : ''}{c.product ? ` · ${c.product}` : ''}{c.associate ? ` · ${c.associate}` : ''} · {dt(c.date)}</div>
          <p>{c.body}</p>
        </div>
        <label className="vd-f"><span>Resposta ao cliente</span><textarea className="vd-in" style={{ minHeight: 96, height: "auto" }} rows={4} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} /></label>
        <div className="kz-acts">
          <button className="vd-btn" disabled={busy || !reply.trim()} onClick={() => void save()}>{busy ? 'A guardar…' : 'Responder'}</button>
          {c.status === 'RESOLVED'
            ? <button className="vd-btn outline" disabled={busy} onClick={() => void save('OPEN')}>Reabrir</button>
            : <button className="vd-btn outline" disabled={busy} onClick={() => void save('RESOLVED')}>Marcar como resolvida</button>}
          {onFreeze ? <button className="vd-btn danger" disabled={busy} onClick={onFreeze}>Congelar saldo do associado</button> : null}
        </div>
      </div>
    </Modal>
  );
}

export function Reviews() {
  const { data, error, load, setError } = useLive(() => api.kwanza.reviews() as Promise<KReview[]>);
  const [cur, setCur] = useState<KReview | null>(null);
  const hide = async (r: KReview) => { try { await api.kwanza.moderateReview(r.id, { hidden: !r.hidden }); toast.success(r.hidden ? 'Avaliação visível' : 'Avaliação oculta'); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Falhou.'); } };
  return (
    <>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}
      <div className="vd-card vd-tablecard">
        {!data ? <div className="vd-empty">A carregar…</div> : !data.length ? <div className="vd-empty">Sem avaliações.</div> : (
          <div className="vd-tablewrap"><table className="vd-table">
            <thead><tr><th>Produto</th><th>Cliente</th><th className="ctr">Estrelas</th><th>Comentário</th><th>Data</th><th className="ctr">Estado</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}>
                <td>{r.product ?? r.productCode}<span className="sub">{r.productCode}</span></td>
                <td><strong>{r.name}</strong><span className="sub">{r.phone}</span></td>
                <td className="ctr" style={{ whiteSpace: 'nowrap' }}><span className="kz-stars" aria-label={`${r.rating} de 5`}>{'★'.repeat(r.rating)}<i>{'★'.repeat(5 - r.rating)}</i></span></td>
                <td className="kz-wrap">{r.comment ?? '—'}{r.reply ? <span className="sub">Resposta: {r.reply}</span> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{dt(r.date)}</td>
                <td className="ctr"><span className={`vd-badge${r.hidden ? ' mute' : ''}`}>{r.hidden ? 'Oculta' : 'Visível'}</span></td>
                <td className="ctr" style={{ whiteSpace: 'nowrap' }}><button className="vd-btn outline sm" onClick={() => setCur(r)}>Responder</button> <button className="vd-btn plain sm" onClick={() => void hide(r)}>{r.hidden ? 'Mostrar' : 'Ocultar'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {cur ? <ReviewReply r={cur} onClose={() => setCur(null)} onSaved={() => { setCur(null); void load(); }} /> : null}
    </>
  );
}

function ReviewReply({ r, onClose, onSaved }: { r: KReview; onClose(): void; onSaved(): void }) {
  const [reply, setReply] = useState(r.reply ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => { setBusy(true); setErr(null); try { await api.kwanza.moderateReview(r.id, { reply }); toast.success('Resposta publicada'); onSaved(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); } finally { setBusy(false); } };
  return (
    <Modal title={`Avaliação de ${r.name}`} onClose={onClose}>
      {err ? <div className="vd-err" style={{ marginBottom: 10 }} role="alert">{err}</div> : null}
      <div className="kz-form">
        <div className="kz-claim"><div><span className="kz-stars">{'★'.repeat(r.rating)}<i>{'★'.repeat(5 - r.rating)}</i></span> · {r.product ?? r.productCode}</div>{r.comment ? <p>{r.comment}</p> : null}</div>
        <label className="vd-f"><span>Resposta pública</span><textarea className="vd-in" style={{ minHeight: 96, height: "auto" }} rows={3} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} /></label>
        <button className="vd-btn" disabled={busy} onClick={() => void save()}>{busy ? 'A guardar…' : 'Guardar'}</button>
      </div>
    </Modal>
  );
}

export function ReturnPolicy() {
  const [f, setF] = useState<{ returnDays: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.kwanza.policy().then((p) => setF({ returnDays: String(p.returnDays), text: p.text ?? '' })).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.')); }, []);
  const save = async () => {
    if (!f) return;
    const days = Number(f.returnDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) { setErr('Prazo entre 0 e 90 dias.'); return; }
    setBusy(true); setErr(null);
    try { await api.kwanza.savePolicy({ returnDays: days, text: f.text.trim() || null }); toast.success('Política de devolução guardada'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); } finally { setBusy(false); }
  };
  return (
    <div className="vd-card" style={{ padding: 18, maxWidth: 640 }}>
      {err ? <div className="vd-err" style={{ marginBottom: 10 }} role="alert">{err}</div> : null}
      {!f ? <div className="vd-empty">A carregar…</div> : (
        <div className="kz-form">
          <label className="vd-f"><span>Prazo de devolução (dias)</span><input className="vd-in" inputMode="numeric" value={f.returnDays} onChange={(e) => setF({ ...f, returnDays: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></label>
          <label className="vd-f"><span>Condições</span><textarea className="vd-in" style={{ minHeight: 96, height: "auto" }} rows={5} maxLength={2000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
          <button className="vd-btn" disabled={busy} onClick={() => void save()}>{busy ? 'A guardar…' : 'Guardar'}</button>
        </div>
      )}
    </div>
  );
}

/** Janela para congelar o saldo de um associado (motivo obrigatório). */
export function FreezeDialog({ name, onClose, onDone, associateId }: { associateId: string; name: string; onClose(): void; onDone(): void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (reason.trim().length < 3) { setErr('Indique o motivo.'); return; }
    setBusy(true); setErr(null);
    try { await api.kwanza.freeze(associateId, reason.trim()); toast.success('Saldo congelado'); onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível congelar.'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Congelar saldo de ${name}`} onClose={onClose}>
      {err ? <div className="vd-err" style={{ marginBottom: 10 }} role="alert">{err}</div> : null}
      <div className="kz-form">
        <label className="vd-f"><span>Motivo</span><textarea className="vd-in" style={{ minHeight: 96, height: "auto" }} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button className="vd-btn danger" disabled={busy} onClick={() => void save()}>{busy ? 'A congelar…' : 'Congelar saldo'}</button>
      </div>
    </Modal>
  );
}
