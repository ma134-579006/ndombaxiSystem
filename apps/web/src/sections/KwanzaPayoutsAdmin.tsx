import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { PayoutRow, PayoutsView } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { Modal } from '../components/ui';

/** Super Admin → Saques LPS Kwanza: reclamações dos associados, aviso + 24 h, banir e reembolsar. */
const kz = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const left = (iso: string | null, now: number) => { if (!iso) return null; const s = Math.floor((new Date(iso).getTime() - now) / 1000); if (s <= 0) return null; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h} h ${String(m).padStart(2, '0')} min`; };
type F = 'open' | 'overdue' | 'closed' | 'all';
const FILTERS: Array<[F, string]> = [['open', 'Reclamações abertas'], ['overdue', 'Fora do prazo'], ['closed', 'Encerradas'], ['all', 'Todas']];
const STEP: Record<string, [string, string]> = { OPEN: ['Reclamado', 'warn'], NOTIFIED: ['Empresa avisada', 'info'], RESOLVED: ['Pago pela empresa', 'ok'], REFUNDED: ['Reembolsado · empresa banida', 'bad'] };

export function KwanzaPayoutsAdmin() {
  const [f, setF] = useState<F>('open');
  const [q, setQ] = useState('');
  const [data, setData] = useState<PayoutsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refund, setRefund] = useState<PayoutRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => api.kwanzaPayouts.list(f, q.trim() || undefined).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.')), [f, q]);
  useEffect(() => { void load(); const t = window.setInterval(() => { setNow(Date.now()); void load(); }, 30_000); return () => window.clearInterval(t); }, [load]);

  const notify = async (r: PayoutRow) => {
    if (!(await confirmDialog({ message: `Avisar ${r.company.name} e dar mais 24 h para pagar ${kz(r.amount)} a ${r.associate.name}?` }))) return;
    try { await api.kwanzaPayouts.notify(r.id); toast.success('Empresa avisada · +24 h'); void load(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível.'); }
  };
  const unban = async (id: string, name: string) => {
    if (!(await confirmDialog({ message: `Readmitir ${name} no LPS Kwanza?` }))) return;
    try { await api.kwanzaPayouts.unban(id); toast.success('Empresa readmitida'); void load(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível.'); }
  };

  const c = data?.counts;
  return (
    <div className="kp-page">
      <div className="content-head"><h2>Saques LPS Kwanza</h2></div>
      <div className="kp-kpis">
        <div className="kp-kpi warn"><span>Reclamações abertas</span><b>{c ? c.open : '—'}</b></div>
        <div className="kp-kpi info"><span>Empresas avisadas</span><b>{c ? c.notified : '—'}</b></div>
        <div className="kp-kpi bad"><span>Saques fora do prazo</span><b>{c ? c.overdue : '—'}</b></div>
        <div className="kp-kpi"><span>Dívida das empresas</span><b>{c ? kz(c.debt) : '—'}</b><small>{c ? `${c.banned} banida${c.banned === 1 ? '' : 's'}` : ''}</small></div>
      </div>
      <div className="kp-bar">
        <div className="kp-tabs" role="tablist">{FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={f === k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
        <input className="kp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código do associado, nome ou empresa" aria-label="Procurar" />
      </div>
      {err ? <div className="banner danger">{err}</div> : null}
      {!data ? <div className="card kp-empty">A carregar…</div> : !data.rows.length ? <div className="card kp-empty">Sem saques neste filtro</div> : (
        <div className="kp-list">
          {data.rows.map((r) => {
            const waitExtra = r.escalation === 'NOTIFIED' ? left(r.extendedUntil, now) : null;
            const late = r.status === 'REQUESTED' && !r.escalation;
            return (
              <article key={r.id} className={`card kp-row ${r.escalation ? `s-${r.escalation.toLowerCase()}` : 'late'}`}>
                <div className="kp-row-top">
                  <div className="kp-amt"><b>{kz(r.amount)}</b><small>{r.method}{r.details ? ` · ${r.details}` : ''}</small></div>
                  <span className={`kp-step ${r.escalation ? STEP[r.escalation]?.[1] : 'bad'}`}>{r.escalation ? STEP[r.escalation]?.[0] : 'Fora do prazo · sem reclamação'}</span>
                </div>
                <div className="kp-people">
                  <div><small>Associado</small><b>{r.associate.name}</b><span className="kp-code">{r.associate.code}</span><span>{r.associate.phone}{r.associate.email ? ` · ${r.associate.email}` : ''}</span></div>
                  <div><small>Empresa</small><b>{r.company.name}{r.company.banned ? <em className="kp-ban">Banida</em> : null}</b><span>{r.company.code}</span><span>{r.company.email}{r.company.phone ? ` · ${r.company.phone}` : ''}</span></div>
                </div>
                <ol className="kp-time">
                  <li className="done"><i /><span>Pedido</span><small>{dt(r.createdAt)}</small></li>
                  <li className={new Date(r.dueAt).getTime() < now ? 'done bad' : ''}><i /><span>Prazo</span><small>{dt(r.dueAt)}</small></li>
                  <li className={r.complainedAt ? 'done' : ''}><i /><span>Reclamação</span><small>{dt(r.complainedAt)}</small></li>
                  <li className={r.notifiedAt ? 'done' : ''}><i /><span>Aviso +24 h</span><small>{r.extendedUntil ? `até ${dt(r.extendedUntil)}` : '—'}</small></li>
                  <li className={r.escalation === 'RESOLVED' || r.escalation === 'REFUNDED' ? 'done' : ''}><i /><span>{r.escalation === 'REFUNDED' ? 'Reembolso' : 'Pagamento'}</span><small>{r.escalation === 'REFUNDED' ? `${dt(r.refundedAt)}${r.refundRef ? ` · ${r.refundRef}` : ''}` : dt(r.decidedAt)}</small></li>
                </ol>
                {r.complaint ? <blockquote className="kp-quote">{r.complaint}</blockquote> : null}
                {r.adminNote ? <p className="kp-note">Nota: {r.adminNote}</p> : null}
                <div className="kp-acts">
                  {r.escalation === 'OPEN' ? <button className="btn" onClick={() => void notify(r)}>Avisar a empresa · +24 h</button> : null}
                  {r.escalation === 'NOTIFIED' ? (waitExtra
                    ? <span className="kp-wait">A empresa ainda tem {waitExtra}</span>
                    : <button className="btn danger" onClick={() => setRefund(r)}>Banir a empresa e reembolsar</button>) : null}
                  {late ? <span className="kp-wait">Aguarda a reclamação do associado</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {data?.bans.length ? (
        <section className="card kp-bans">
          <h3>Empresas banidas</h3>
          {data.bans.map((b) => (
            <div key={b.companyId} className="kp-banrow">
              <div><b>{b.name}</b><small>{b.code} · {dt(b.date)}</small><small>{b.reason}</small></div>
              <div className="kp-debt"><small>Dívida</small><b>{kz(b.debt)}</b></div>
              <button className="btn ghost" onClick={() => void unban(b.companyId, b.name)}>Readmitir</button>
            </div>
          ))}
        </section>
      ) : null}
      {refund ? <RefundModal r={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); toast.success('Empresa banida · reembolso registado'); void load(); }} /> : null}
    </div>
  );
}

function RefundModal({ r, onClose, onDone }: { r: PayoutRow; onClose(): void; onDone(): void }) {
  const [ref, setRef] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api.kwanzaPayouts.banRefund(r.id, ref.trim(), note.trim() || undefined); onDone(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Banir e reembolsar" onClose={onClose}>
      <div className="kp-modal">
        <div className="kp-modal-sum"><span>Reembolso a <b>{r.associate.name}</b> ({r.associate.code})</span><b className="kp-modal-amt">{kz(r.amount)}</b><span>Conta: {r.method}{r.details ? ` · ${r.details}` : ''}</span></div>
        <div className="banner danger" style={{ margin: '12px 0' }}>{r.company.name} sai do LPS Kwanza e o valor fica como dívida da empresa.</div>
        {err ? <div className="banner danger">{err}</div> : null}
        <div className="field"><label>Referência da transferência do reembolso</label><input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} autoFocus /></div>
        <div className="field"><label>Nota (opcional)</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} /></div>
        <div className="kp-acts"><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn danger" disabled={busy || ref.trim().length < 3} onClick={() => void go()}>{busy ? 'A registar…' : 'Banir e registar reembolso'}</button></div>
      </div>
    </Modal>
  );
}
