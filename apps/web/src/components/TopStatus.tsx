import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconAlertCircle, IconCheckCircle, IconHelp, IconPlus, IconShieldCheck } from './Icons';
import { pollEvery, stopPoll } from '../poll';

/* Barra de topo no padrão do backoffice de referência: estado da subscrição
   (anel com dias restantes), estado AGT (Ativo/Inativo), "+" (criar rápido) e
   "?" (ajuda). Cada bloco só aparece quando o papel tem acesso aos dados —
   um 403 esconde o bloco em vez de mostrar erro. */

/** Pedido de "criar novo" vindo do botão "+": a secção destino lê e consome. */
export const QUICK_CREATE_KEY = 'nx:quick-create';
export function takeQuickCreate(section: string): boolean {
  try {
    if (sessionStorage.getItem(QUICK_CREATE_KEY) !== section) return false;
    sessionStorage.removeItem(QUICK_CREATE_KEY);
    return true;
  } catch { return false; }
}

export function TopTitle({ title }: { title: string }) {
  return <h1 className="tb-title" key={title}>{title}</h1>;
}

type RingInfo = { total: number; used: number; left: number; pct: number; end?: string | null; vendus?: { plan: string | null; renewUrl: string } };

/** Anel da subscrição: aparece só a COMPANY_ADMIN e quando faltam ≤30 dias. */
export function SubscriptionRing({ enabled, onGo }: { enabled: boolean; onGo?: () => void }) {
  // Período em dias: consumidos (X de N = Y%) e restantes (Z dias = 100 − Y %).
  const [info, setInfo] = useState<RingInfo | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  useEffect(() => {
    if (!enabled) { setInfo(null); return; }
    let alive = true;
    const calc = (end: number, start: number) => {
      const total = Math.max(1, Math.round((end - start) / 864e5));
      const left = Math.min(total, Math.max(0, Math.ceil((end - Date.now()) / 864e5)));
      const used = total - left;
      return { total, used, left, pct: Math.round((used / total) * 100) };
    };
    // Endpoint resumido (todas as funções); se ainda não existir na API, calcula a partir das subscrições.
    const fromMine = (): Promise<RingInfo | null> => api.subscription.mine().then((subs) => {
      const act = subs.filter((x) => x.status === 'ACTIVE' && x.expiresAt)
        .sort((a, b) => Date.parse(b.expiresAt!) - Date.parse(a.expiresAt!))[0];
      if (!act?.expiresAt) return null;
      const end = Date.parse(act.expiresAt);
      const start = act.startsAt ? Date.parse(act.startsAt) : end - (act.durationDays ?? act.durationMonths * 30) * 864e5;
      return { ...calc(end, start), end: act.expiresAt };
    });
    api.subscription.status()
      .then((st): RingInfo | null | Promise<RingInfo | null> => {
        // Motor Cegid Vendus: plano, fim e percentagem do VENDUS (a renovação é lá).
        if (st.provider === 'VENDUS') return st.active ? { total: st.totalDays ?? 30, used: st.usedDays ?? 0, left: st.daysLeft, pct: st.pct, end: st.expiresAt, vendus: { plan: st.plan ?? null, renewUrl: st.renewUrl ?? 'https://www.vendus.co.ao/login/' } } : null;
        if (!st.active) return null;
        if (st.totalDays) return { total: st.totalDays, used: st.usedDays ?? st.totalDays - st.daysLeft, left: st.daysLeft, pct: st.pct, end: st.expiresAt };
        return fromMine();
      })
      .catch(() => fromMine())
      .then((v) => { if (alive) setInfo(v); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [enabled]);
  if (!info) return null;
  // Cor como no Vendus: azul até 74%, laranja 75–89%, vermelho a partir de 90%.
  const tone = info.pct < 75 ? 'ok' : info.pct < 90 ? 'warn' : 'bad';
  // Como no backoffice de referência: só o texto e o anel; os dias que faltam
  // aparecem numa dica ANIMADA ao passar o rato (ou ao focar com o teclado).
  const tip = info.left === 0 ? 'A subscrição termina hoje' : info.left === 1 ? 'Falta 1 dia para renovar' : `Faltam ${info.left} dias para renovar`;
  const endTx = info.end ? new Date(info.end).toLocaleDateString('pt-PT') : null;
  return (
    <div className="tb-sub-wrap" ref={boxRef}>
    {open ? (
      <div className="tb-menu tb-sub-menu" role="dialog" aria-label="Subscrição">
        {info.vendus ? <span className="muted">Cegid Vendus{info.vendus.plan ? ` · Plano ${info.vendus.plan}` : ''}</span> : null}
        <b>{tip}</b>
        {endTx ? <span>Termina a {endTx}</span> : null}
        {info.vendus
          ? <a className="vd-btn" href={info.vendus.renewUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Renovar no Vendus</a>
          : onGo ? <button className="vd-btn" onClick={() => { setOpen(false); onGo(); }}>Renovar subscrição</button> : null}
      </div>
    ) : null}
    <button className={`tb-sub ${tone}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={tip}>
      {open ? null : <span className="tb-sub-tip" role="tooltip">{tip}</span>}
      <span className="tb-sub-tx">Renovar subscrição</span>
      {/* Anel do Vendus: círculo perfeito (conic-gradient recortado) e o número centrado. */}
      <span className="tb-ring" aria-hidden="true" style={{ ['--tb-p' as string]: Math.min(100, Math.max(0, info.pct)) } as import('react').CSSProperties}>
        <b>{info.pct}<small>%</small></b>
      </span>
    </button>
    </div>
  );
}

/** Selo da facturação pelo Cegid Vendus (software validado pela AGT). Só aparece
 *  quando o motor efectivo é o Vendus; o LPS Vendas nunca se apresenta como
 *  certificado. */
export interface VendusSeal { validationNo?: string; feCertNo?: string; validUntil?: string | null }

function sealTitle(v: VendusSeal) {
  const parts = ['Facturação emitida pelo Cegid Vendus, software validado pela AGT'];
  if (v.validationNo) parts.push(v.validationNo);
  if (v.feCertNo) parts.push(v.feCertNo);
  if (v.validUntil) parts.push(`válido até ${new Date(`${v.validUntil}T00:00:00`).toLocaleDateString('pt-PT')}`);
  return parts.join(' · ');
}

/** Estado AGT. Empresa: comunicação eletrónica ligada e configurada, ou o selo
 *  Vendus quando a facturação é emitida pelo Cegid Vendus. Super Admin: contrato
 *  AGT subscrito, ou o selo quando o motor externo está ligado e confirmado.
 *  `badge`: papéis da caixa, que só vêem o selo. */
export function AgtStatus({ mode, onGo }: { mode: 'tenant' | 'badge' | 'platform' | 'none'; onGo(): void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [seal, setSeal] = useState<VendusSeal | null>(null);
  useEffect(() => {
    if (mode === 'none') { setOn(null); setSeal(null); return; }
    let alive = true;
    const tick = () => {
      const sealP: Promise<VendusSeal | null> = mode === 'platform'
        ? api.fiscalEngine.overview().then((o) => (o.settings.vendusEnabled && o.validity.status === 'CONFIRMADO'
          ? { validationNo: o.settings.providerValidationNo, feCertNo: o.settings.providerFeCertNo, validUntil: o.settings.providerValidUntil }
          : null))
        : api.fiscalEngine.badge().then((b) => (b.vendus ? { validationNo: b.validationNo, feCertNo: b.feCertNo, validUntil: b.validUntil } : null));
      sealP.catch(() => null).then((v) => {
        if (!alive) return;
        setSeal(v);
        if (v || mode === 'badge') { setOn(null); return; }
        const p = mode === 'tenant'
          ? api.agtComm.status().then((s) => s.enabled && s.configured)
          : api.fiscal.get().then((c) => c.subscribed);
        p.then((x) => { if (alive) setOn(x); }).catch(() => { if (alive) setOn(null); });
      });
    };
    tick();
    const t = pollEvery(tick, 60000);
    return () => { alive = false; stopPoll(t); };
  }, [mode]);
  if (seal) {
    const title = sealTitle(seal);
    const inner = (
      <>
        <IconShieldCheck size={30} />
        <span className="tb-agt-tx"><b>Vendus</b><small>Facturação certificada</small></span>
      </>
    );
    return mode === 'badge'
      ? <span className="tb-agt on vendus" title={title} aria-label={title} tabIndex={0}>{inner}</span>
      : <button className="tb-agt on vendus" onClick={onGo} title={title} aria-label={title}>{inner}</button>;
  }
  if (on === null) return null;
  return (
    <button className={`tb-agt ${on ? 'on' : 'off'}`} onClick={onGo} title="Estado da comunicação com a AGT">
      {on ? <IconCheckCircle size={30} /> : <IconAlertCircle size={30} />}
      <span className="tb-agt-tx"><b>AGT</b><small>{on ? 'Ativo' : 'Inativo'}</small></span>
    </button>
  );
}

export interface QuickItem { key: string; label: string; create?: boolean }

/** Botões redondos "+" e "?". O "+" abre um menu com as criações rápidas
 *  permitidas ao papel (só secções presentes na navegação). */
export function TopActions({ quick, help, onGo }: { quick: QuickItem[]; help: string | null; onGo(section: string): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  if (!quick.length && !help) return null;
  return (
    <div className="tb-actions">
      {quick.length ? (
        <div className="tb-quick" ref={ref}>
          <button className={`tb-round${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Criar novo" aria-expanded={open} title="Criar novo">
            <IconPlus size={20} />
          </button>
          {open ? (
            <div className="tb-menu" role="menu">
              {quick.map((q) => (
                <button key={q.key} role="menuitem" onClick={() => {
                  if (q.create) { try { sessionStorage.setItem(QUICK_CREATE_KEY, q.key); } catch { /* ignora */ } }
                  setOpen(false); onGo(q.key);
                }}>{q.label}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {help ? (
        <button className="tb-round help" onClick={() => onGo(help)} aria-label="Ajuda" title="Ajuda">
          <IconHelp size={20} />
        </button>
      ) : null}
    </div>
  );
}

export const TopDivider = () => <span className="tb-div" aria-hidden="true" />;
