import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconAlertCircle, IconCheckCircle, IconHelp, IconPlus } from './Icons';
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

/** Anel da subscrição: aparece só a COMPANY_ADMIN e quando faltam ≤30 dias. */
export function SubscriptionRing({ enabled, onGo }: { enabled: boolean; onGo?: () => void }) {
  // Período em dias: consumidos (X de N = Y%) e restantes (Z dias = 100 − Y %).
  const [info, setInfo] = useState<{ total: number; used: number; left: number; pct: number } | null>(null);
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
    const fromMine = () => api.subscription.mine().then((subs) => {
      const act = subs.filter((x) => x.status === 'ACTIVE' && x.expiresAt)
        .sort((a, b) => Date.parse(b.expiresAt!) - Date.parse(a.expiresAt!))[0];
      if (!act?.expiresAt) return null;
      const end = Date.parse(act.expiresAt);
      const start = act.startsAt ? Date.parse(act.startsAt) : end - (act.durationDays ?? act.durationMonths * 30) * 864e5;
      return calc(end, start);
    });
    api.subscription.status()
      .then((st) => {
        if (!st.active) return null;
        if (st.totalDays) return { total: st.totalDays, used: st.usedDays ?? st.totalDays - st.daysLeft, left: st.daysLeft, pct: st.pct };
        return fromMine();
      })
      .catch(() => fromMine())
      .then((v) => { if (alive) setInfo(v); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [enabled]);
  if (!info) return null;
  // Cor pelo consumido: até 60% verde, 61–80% laranja, acima de 80% vermelho.
  const tone = info.pct <= 60 ? 'ok' : info.pct <= 80 ? 'warn' : 'bad';
  const r = 15, c = 2 * Math.PI * r;
  const tip = `${info.total} dias de subscrição · consumidos ${info.used} (${info.pct}%) · faltam ${info.left} (${100 - info.pct}%)`;
  return (
    <button className={`tb-sub ${tone}`} onClick={onGo} disabled={!onGo} title={tip} aria-label={tip}>
      <span className="tb-sub-tx">Renovar subscrição<small>{info.used} de {info.total} dias · faltam {info.left}</small></span>
      <span className="tb-ring" aria-hidden="true">
        <svg width="38" height="38" viewBox="0 0 38 38">
          <circle cx="19" cy="19" r={r} className="trk" />
          <circle cx="19" cy="19" r={r} className="val" strokeDasharray={c} strokeDashoffset={c * (1 - info.pct / 100)} />
        </svg>
        <b>{info.pct}%</b>
      </span>
    </button>
  );
}

/** Estado AGT. Empresa: comunicação eletrónica ligada e configurada.
 *  Super Admin: contrato AGT subscrito. */
export function AgtStatus({ mode, onGo }: { mode: 'tenant' | 'platform' | 'none'; onGo(): void }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (mode === 'none') { setOn(null); return; }
    let alive = true;
    const tick = () => {
      const p = mode === 'tenant'
        ? api.agtComm.status().then((s) => s.enabled && s.configured)
        : api.fiscal.get().then((c) => c.subscribed);
      p.then((v) => { if (alive) setOn(v); }).catch(() => { if (alive) setOn(null); });
    };
    tick();
    const t = pollEvery(tick, 60000);
    return () => { alive = false; stopPoll(t); };
  }, [mode]);
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
