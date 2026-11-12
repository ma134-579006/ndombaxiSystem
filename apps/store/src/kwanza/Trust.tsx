import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api/client';
import { I, P } from '../members/parts';
import { kw, type Complaint, type Listing, type Social } from './api';

/** Identificador anónimo deste navegador (um gosto por dispositivo e produto). */
function deviceId(): string {
  try {
    let d = localStorage.getItem('kw.device');
    if (!d) { d = crypto.randomUUID(); localStorage.setItem('kw.device', d); }
    return d;
  } catch { return 'anon-0000-0000-0000-000000000000'; }
}

const KINDS: [string, string][] = [
  ['NOT_RECEIVED', 'Não recebi a encomenda'], ['DAMAGED', 'Produto danificado'], ['NOT_AS_DESCRIBED', 'Diferente do anunciado'],
  ['REFUND', 'Devolução ou reembolso'], ['SELLER', 'Problema com o vendedor'], ['OTHER', 'Outro'],
];
const ST: Record<string, string> = { OPEN: 'Em análise', ANSWERED: 'Respondida', RESOLVED: 'Resolvida' };
const fmt = (iso: string) => new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });

export function Stars({ value, size = 16, onPick }: { value: number; size?: number; onPick?(n: number): void }) {
  return (
    <span className={`kw-stars${onPick ? ' pick' : ''}`} role={onPick ? 'radiogroup' : 'img'} aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => onPick
        ? <button type="button" key={n} role="radio" aria-checked={value === n} aria-label={`${n} estrela${n > 1 ? 's' : ''}`} className={n <= value ? 'on' : ''} onClick={() => onPick(n)}><I d={P.star} size={size} /></button>
        : <i key={n} className={n <= Math.round(value) ? 'on' : ''}><I d={P.star} size={size} /></i>)}
    </span>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <>
      <div className="kw-scrim" onClick={onClose} />
      <div className="kw-post kw-pop kw-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="kw-post-h"><div className="kw-row-main"><b>{title}</b></div><button className="kw-x" onClick={onClose} aria-label="Fechar"><I d={P.close} size={18} /></button></header>
        <div className="kw-post-body">{children}</div>
      </div>
    </>,
    document.querySelector('.kw-root') ?? document.body,
  );
}

/** Formulário de reclamação; no fim mostra o código para acompanhar. */
export function ComplaintForm({ companyCode, companies, productCode, associateCode, onDone }: { companyCode?: string; companies?: { code: string; name: string }[]; productCode?: string; associateCode?: string; onDone?(code: string): void }) {
  const [f, setF] = useState({ companyCode: companyCode ?? companies?.[0]?.code ?? '', kind: 'NOT_RECEIVED', orderNumber: '', name: '', phone: '', body: '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [code, setCode] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.companyCode) { setErr('Escolha a empresa.'); return; }
    if (f.body.trim().length < 10) { setErr('Descreva o problema (mínimo 10 caracteres).'); return; }
    setBusy(true);
    try { const r = await kw.complain({ ...f, orderNumber: f.orderNumber || undefined, productCode, associateCode }); setCode(r.code); onDone?.(r.code); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível enviar.'); } finally { setBusy(false); }
  };
  if (code) return <div className="kw-claim-ok" role="status"><span className="kw-toast-ic"><I d={P.check} size={18} /></span><div><small>Código da reclamação</small><b>{code}</b></div></div>;
  return (
    <form className="kw-form2" onSubmit={(e) => void submit(e)}>
      {!companyCode && companies ? <label className="kw-f"><span>Empresa</span><select value={f.companyCode} onChange={set('companyCode')}>{companies.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label> : null}
      <label className="kw-f"><span>Motivo</span><select value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="kw-f"><span>N.º da encomenda</span><input value={f.orderNumber} onChange={set('orderNumber')} maxLength={40} /></label>
      <label className="kw-f"><span>Nome</span><input value={f.name} onChange={set('name')} autoComplete="name" required minLength={2} maxLength={80} /></label>
      <label className="kw-f"><span>Telefone</span><input value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" required placeholder="9XX XXX XXX" /></label>
      <label className="kw-f kw-f-wide"><span>Descrição</span><textarea rows={4} value={f.body} onChange={set('body')} maxLength={2000} required /></label>
      {err ? <div className="kw-err kw-f-wide" role="alert">{err}</div> : null}
      <button className="kw-btn kw-btn-primary kw-f-wide" disabled={busy}>{busy ? 'A enviar…' : 'Enviar reclamação'}</button>
    </form>
  );
}

/** Acompanhar uma reclamação pelo código (sem sessão). */
export function ComplaintTrack() {
  const [code, setCode] = useState(''); const [c, setC] = useState<Complaint | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const find = async (e: React.FormEvent) => { e.preventDefault(); setErr(null); setC(null); setBusy(true); try { setC(await kw.complaint(code)); } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível consultar.'); } finally { setBusy(false); } };
  return (
    <div className="kw-track">
      <form className="kw-track-f" onSubmit={(e) => void find(e)}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Código da reclamação" aria-label="Código da reclamação" maxLength={12} required />
        <button className="kw-btn kw-btn-primary" disabled={busy}>{busy ? 'A procurar…' : 'Consultar'}</button>
      </form>
      {err ? <div className="kw-err" role="alert">{err}</div> : null}
      {c ? (
        <div className="kw-claim">
          <div className="kw-claim-h"><b>{c.company}</b><span className={`kw-pill kw-cl-${c.status}`}>{ST[c.status] ?? c.status}</span></div>
          <small>{KINDS.find(([k]) => k === c.kind)?.[1] ?? c.kind} · {fmt(c.date)}</small>
          <p>{c.body}</p>
          {c.reply ? <div className="kw-claim-reply"><small>Resposta da empresa{c.repliedAt ? ` · ${fmt(c.repliedAt)}` : ''}</small><p>{c.reply}</p></div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Página do produto: estrelas, gostos, devolução, reclamação e avaliações. */
export function ProductSocial({ l, flash }: { l: Listing; flash(t: string): void }) {
  const [s, setS] = useState<Social | null>(null);
  const [sheet, setSheet] = useState<'review' | 'claim' | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { kw.social(l.companyCode, l.productCode, deviceId()).then(setS).catch(() => setS(null)); }, [l.companyCode, l.productCode]);
  useEffect(() => {
    setS(null); load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15_000);
    return () => window.clearInterval(t);
  }, [load]);
  const react = async (v: 1 | -1) => {
    if (!s || busy) return;
    setBusy(true);
    try { setS(await kw.react(l.companyCode, l.productCode, deviceId(), s.mine === v ? 0 : v)); } catch { /* fica como estava */ } finally { setBusy(false); }
  };
  if (!s) return null;
  return (
    <section className="kw-social" aria-label="Avaliações e garantias">
      <div className="kw-social-top">
        <div className="kw-rate">
          <b>{s.count ? s.rating.toLocaleString('pt-PT', { minimumFractionDigits: 1 }) : '—'}</b>
          <div><Stars value={s.rating} size={18} /><small>{s.count} avaliaç{s.count === 1 ? 'ão' : 'ões'}</small></div>
        </div>
        <div className="kw-rate-bars" aria-hidden="true">
          {[5, 4, 3, 2, 1].map((n) => <div key={n}><span>{n}</span><i><em style={{ width: `${s.count ? (s.stars[n] / s.count) * 100 : 0}%` }} /></i><span>{s.stars[n]}</span></div>)}
        </div>
        <div className="kw-react">
          <button className={`kw-react-b${s.mine === 1 ? ' on' : ''}`} aria-pressed={s.mine === 1} disabled={busy} onClick={() => void react(1)}><I d={P.like} size={18} /><span>Gosto</span><b>{s.likes}</b></button>
          <button className={`kw-react-b down${s.mine === -1 ? ' on' : ''}`} aria-pressed={s.mine === -1} disabled={busy} onClick={() => void react(-1)}><I d={P.dislike} size={18} /><span>Não gosto</span><b>{s.dislikes}</b></button>
        </div>
      </div>

      <div className="kw-guar">
        <div className="kw-guar-i"><span><I d={P.shield} size={20} /></span><div><b>{s.policy.returnDays > 0 ? `Devolução em ${s.policy.returnDays} dias` : 'Sem devolução'}</b>{s.policy.text ? <p>{s.policy.text}</p> : null}</div></div>
        <div className="kw-guar-i"><span><I d={P.card} size={20} /></span><div><b>Reembolso do valor pago</b></div></div>
        <div className="kw-guar-i"><span><I d={P.truck} size={20} /></span><div><b>Entrega seguida por GPS</b></div></div>
        <button className="kw-btn kw-btn-outline" onClick={() => setSheet('claim')}><I d={P.flag} size={16} /> Reclamar</button>
      </div>

      <div className="kw-revs">
        <div className="kw-revs-h"><h3>Avaliações</h3><button className="kw-btn kw-btn-primary" onClick={() => setSheet('review')}><I d={P.star} size={16} /> Avaliar</button></div>
        {s.reviews.length ? s.reviews.map((r) => (
          <article key={r.id} className="kw-rev">
            <span className="kw-rev-av" aria-hidden="true">{r.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <div className="kw-rev-h"><b>{r.name}</b><span className="kw-pill kw-st-PAID">Compra verificada</span><small>{fmt(r.date)}</small></div>
              <Stars value={r.rating} size={14} />
              {r.comment ? <p>{r.comment}</p> : null}
              {r.reply ? <div className="kw-claim-reply"><small>Resposta de {l.companyName}</small><p>{r.reply}</p></div> : null}
            </div>
          </article>
        )) : <div className="kw-empty2">Sem avaliações</div>}
      </div>

      {sheet === 'review' ? <Sheet title={`Avaliar ${l.name}`} onClose={() => setSheet(null)}><ReviewForm l={l} onDone={() => { setSheet(null); flash('Avaliação publicada'); load(); }} /></Sheet> : null}
      {sheet === 'claim' ? <Sheet title="Reclamação" onClose={() => setSheet(null)}><ComplaintForm companyCode={l.companyCode} productCode={l.productCode} associateCode={l.associate?.code} /></Sheet> : null}
    </section>
  );
}

function ReviewForm({ l, onDone }: { l: Listing; onDone(): void }) {
  const [f, setF] = useState({ name: '', phone: '', rating: 5, comment: '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await kw.review(l.companyCode, l.productCode, { ...f, comment: f.comment || undefined }); onDone(); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível enviar.'); } finally { setBusy(false); }
  };
  return (
    <form className="kw-form2" onSubmit={(e) => void submit(e)}>
      <div className="kw-f kw-f-wide"><span>Classificação</span><Stars value={f.rating} size={30} onPick={(n) => setF({ ...f, rating: n })} /></div>
      <label className="kw-f"><span>Nome</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required minLength={2} maxLength={80} /></label>
      <label className="kw-f"><span>Telefone da encomenda</span><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" autoComplete="tel" required placeholder="9XX XXX XXX" /></label>
      <label className="kw-f kw-f-wide"><span>Comentário</span><textarea rows={4} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} maxLength={1000} /></label>
      {err ? <div className="kw-err kw-f-wide" role="alert">{err}</div> : null}
      <button className="kw-btn kw-btn-primary kw-f-wide" disabled={busy}>{busy ? 'A enviar…' : 'Publicar avaliação'}</button>
    </form>
  );
}

/** Página "Reclamações": abrir uma reclamação e acompanhar pelo código. */
export function Claims({ companies }: { companies: { code: string; name: string }[] }) {
  return (
    <div className="kw-container kw-claims">
      <section className="kw-sec"><header className="kw-sec-h"><h3>Acompanhar reclamação</h3></header><div className="kw-sec-b"><ComplaintTrack /></div></section>
      <section className="kw-sec"><header className="kw-sec-h"><h3>Nova reclamação</h3></header><div className="kw-sec-b">{companies.length ? <ComplaintForm companies={companies} /> : <div className="kw-empty2">Sem empresas</div>}</div></section>
    </div>
  );
}
