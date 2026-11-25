import { LangChoice, IconGlobe } from './LangPicker';
import React, { useEffect, useRef, useState } from 'react';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { IconLogout, IconCashRegister, IconHistory, IconCard, IconDownload, IconStore, IconBuilding, IconGear as EvaGear, IconBoxes, IconUser as EvaUser } from './Icons';
import { THEMES, getTheme, setTheme } from '../theme';
import { PrintBrandHead, PrintBrandFoot } from './PrintBrand';
import { ChatModal } from './ChatModal';
import { CustomerChatModal } from './CustomerChatModal';
import { IdleLock } from './IdleLock';
import { cachedPhoto, rememberPhoto } from '../photoCache';
import { SyncStatusPill } from '../offline/SyncStatusPill';
import { Modal } from './ui';
import { UserAvatar, displayName } from './UserAvatar';
import type { SalaryAdvanceReq } from '../api/types';
import { openCaixaTerminal, STORE_URL } from '../config';
import { pollEvery, stopPoll } from '../poll';
import { NotificationCenter } from './NotificationCenter';
import { useFullscreen } from '../fullscreen';
import { AgtStatus, SubscriptionRing, TopActions, TopDivider, TopTitle, type QuickItem } from './TopStatus';

/** Sino de notificações (Super Admin): conversas por responder + comentários
 *  novos do site — com badge e dropdown estilo rede social. */
function NotifyBell({ onGo }: { onGo(section: string): void }) {
  const [n, setN] = useState<{ unreadChats: number; humanWaiting: number; newFeedback: number; pendingCompanies?: number; pendingSubs?: number } | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => { api.support.admin.notifications().then((r) => { if (alive) setN(r); }).catch(() => undefined); };
    tick();
    const t = pollEvery(tick, 20000);
    return () => { alive = false; stopPoll(t); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const total = (n?.unreadChats ?? 0) + (n?.newFeedback ?? 0) + (n?.pendingCompanies ?? 0) + (n?.pendingSubs ?? 0);
  return (
    <div className="noti-wrap" ref={ref}>
      <button className="icon-btn noti-btn" onClick={() => setOpen((v) => !v)} title="Notificações" aria-label="Notificações">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 15.21l-1.8-1.81V8.94a6.86 6.86 0 0 0-5.82-6.88 6.74 6.74 0 0 0-7.62 6.67v4.67l-1.8 1.81A1.64 1.64 0 0 0 4.64 18H8v.34A3.84 3.84 0 0 0 12 22a3.84 3.84 0 0 0 4-3.66V18h3.36a1.64 1.64 0 0 0 1.16-2.79zM14 18.34A1.88 1.88 0 0 1 12 20a1.88 1.88 0 0 1-2-1.66V18h4zM5.51 16l1.18-1.18a2 2 0 0 0 .59-1.42V8.73A4.73 4.73 0 0 1 8.9 5.17 4.67 4.67 0 0 1 12.64 4a4.86 4.86 0 0 1 4.08 4.9v4.5a2 2 0 0 0 .58 1.42L18.49 16z" /></svg>
        {total > 0 ? <span className="noti-badge">{total > 99 ? '99+' : total}</span> : null}
      </button>
      {open ? (
        <div className="noti-pop">
          <div className="noti-head">Notificações</div>
          <button className="noti-item" onClick={() => { setOpen(false); onGo('support'); }}>
            <span style={{ flex: 1, textAlign: 'left' }}>
              {n?.unreadChats ? <><strong>{n.unreadChats}</strong> conversa(s) por responder{n.humanWaiting ? ` · ${n.humanWaiting} à espera da equipa` : ''}</> : 'Sem conversas novas'}
            </span>
            {n?.unreadChats ? <span className="noti-badge inline">{n.unreadChats}</span> : null}
          </button>
          <button className="noti-item" onClick={() => { setOpen(false); onGo('feedback'); }}>
            <span style={{ flex: 1, textAlign: 'left' }}>
              {n?.newFeedback ? <><strong>{n.newFeedback}</strong> comentário(s) novo(s) no site</> : 'Sem comentários novos'}
            </span>
            {n?.newFeedback ? <span className="noti-badge inline">{n.newFeedback}</span> : null}
          </button>
          <button className="noti-item" onClick={() => { setOpen(false); onGo('tenants'); }}>
            <span style={{ flex: 1, textAlign: 'left' }}>
              {n?.pendingCompanies ? <><strong>{n.pendingCompanies}</strong> empresa(s) por aprovar</> : 'Sem empresas por aprovar'}
            </span>
            {n?.pendingCompanies ? <span className="noti-badge inline">{n.pendingCompanies}</span> : null}
          </button>
          <button className="noti-item" onClick={() => { setOpen(false); onGo('subs'); }}>
            <span style={{ flex: 1, textAlign: 'left' }}>
              {n?.pendingSubs ? <><strong>{n.pendingSubs}</strong> pagamento(s)/renovação(ões) por rever</> : 'Sem pagamentos por rever'}
            </span>
            {n?.pendingSubs ? <span className="noti-badge inline">{n.pendingSubs}</span> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const fmtKz = (v: number) => `${Math.round(v).toLocaleString('pt-PT')} Kz`;

/** Dados dos pedidos de ADIANTAMENTO SALARIAL pendentes (gestor/gerente): faz
 *  polling enquanto `enabled`, e expõe a lista + a ação de aprovar/rejeitar. O
 *  número de pendentes alimenta o badge no perfil. */
function useAdvances(enabled: boolean) {
  const [items, setItems] = useState<SalaryAdvanceReq[]>([]);
  const load = () => { api.advances.pending().then(setItems).catch(() => undefined); };
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = () => { api.advances.pending().then((r) => { if (alive) setItems(r); }).catch(() => undefined); };
    tick();
    const t = pollEvery(tick, 20000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; stopPoll(t); window.removeEventListener('focus', onFocus); };
  }, [enabled]);
  const review = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try { await api.advances.review(id, decision); setItems((prev) => prev.filter((i) => i.id !== id)); }
    catch { load(); }
  };
  return { items, review };
}

/** Modal (centrado e 100% responsivo, via <Modal> com portal) com os pedidos de
 *  adiantamento pendentes e os botões Aceitar/Rejeitar. */
function AdvancesModal({ items, onReview, onClose }: {
  items: SalaryAdvanceReq[]; onReview(id: string, d: 'APPROVED' | 'REJECTED'): Promise<void>; onClose(): void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, d: 'APPROVED' | 'REJECTED') => { setBusy(id); try { await onReview(id, d); } finally { setBusy(null); } };
  return (
    <Modal title="Pedidos de adiantamento" onClose={onClose}>
      {items.length > 0 ? (
        <div className="erp-kpis">
          <div className="erp-kpi"><span>Pedidos pendentes</span><b>{items.length}</b></div>
          <div className="erp-kpi hi"><span>Valor total</span><b>{fmtKz(items.reduce((t, x) => t + Number(x.amount), 0))}</b></div>
        </div>
      ) : null}
      <div className="adv-list">
        {items.length === 0 ? (
          <div className="adv-empty">Sem pedidos de adiantamento pendentes.</div>
        ) : items.map((a) => {
          const pay = Number(a.monthly_pay) || 0;
          const pct = pay > 0 ? Math.min(100, Math.round((Number(a.amount) / pay) * 100)) : null;
          return (
            <div key={a.id} className="adv-req2">
              <UserAvatar name={a.staff_name} size={42} />
              <div className="adv-req2-main">
                <strong>{a.staff_name}</strong>
                <div className="adv-req-meta">
                  {pay ? `Salário ${fmtKz(pay)}` : 'Salário n/d'}{pct !== null ? ` · ${pct}% do salário` : ''}
                  {' · '}{new Date(a.requested_at).toLocaleDateString('pt-PT')}
                  {a.reason ? ` · ${a.reason}` : ''}
                </div>
              </div>
              <strong className="adv-req2-amt">{fmtKz(Number(a.amount))}</strong>
              <div className="adv-req2-act">
                <button className="btn sm ok" disabled={busy === a.id} onClick={() => void act(a.id, 'APPROVED')}>Aceitar</button>
                <button className="btn sm ghost danger" disabled={busy === a.id} onClick={() => void act(a.id, 'REJECTED')}>Rejeitar</button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** Hambúrguer (só visível no telemóvel via CSS). */
function IconMenu({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="11" width="18" height="2" rx=".95" ry=".95" /><rect x="3" y="16" width="18" height="2" rx=".95" ry=".95" /><rect x="3" y="6" width="18" height="2" rx=".95" ry=".95" /></svg>
  );
}

/** Ícone de utilizador (placeholder do avatar quando não há foto). */
function IconUser({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0-6a2 2 0 1 1-2 2 2 2 0 0 1 2-2z" /><path d="M12 13a7 7 0 0 0-7 7 1 1 0 0 0 2 0 5 5 0 0 1 10 0 1 1 0 0 0 2 0 7 7 0 0 0-7-7z" /></svg>
  );
}

function IconGear({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12.94 22h-1.89a1.68 1.68 0 0 1-1.68-1.68v-1.09a.34.34 0 0 0-.22-.29.38.38 0 0 0-.41 0l-.74.8a1.67 1.67 0 0 1-2.37 0L4.26 18.4a1.66 1.66 0 0 1-.5-1.19 1.72 1.72 0 0 1 .5-1.21l.74-.74a.34.34 0 0 0 0-.37c-.06-.15-.16-.26-.3-.26H3.68A1.69 1.69 0 0 1 2 12.94v-1.89a1.68 1.68 0 0 1 1.68-1.68h1.09a.34.34 0 0 0 .29-.22.38.38 0 0 0 0-.41L4.26 8a1.67 1.67 0 0 1 0-2.37L5.6 4.26a1.65 1.65 0 0 1 1.18-.5 1.72 1.72 0 0 1 1.22.5l.74.74a.34.34 0 0 0 .37 0c.15-.06.26-.16.26-.3V3.68A1.69 1.69 0 0 1 11.06 2H13a1.68 1.68 0 0 1 1.68 1.68v1.09a.34.34 0 0 0 .22.29.38.38 0 0 0 .41 0l.69-.8a1.67 1.67 0 0 1 2.37 0l1.37 1.34a1.67 1.67 0 0 1 .5 1.19 1.63 1.63 0 0 1-.5 1.21l-.74.74a.34.34 0 0 0 0 .37c.06.15.16.26.3.26h1.09A1.69 1.69 0 0 1 22 11.06V13a1.68 1.68 0 0 1-1.68 1.68h-1.09a.34.34 0 0 0-.29.22.34.34 0 0 0 0 .37l.77.77a1.67 1.67 0 0 1 0 2.37l-1.31 1.33a1.65 1.65 0 0 1-1.18.5 1.72 1.72 0 0 1-1.19-.5l-.77-.74a.34.34 0 0 0-.37 0c-.15.06-.26.16-.26.3v1.09A1.69 1.69 0 0 1 12.94 22zm-1.57-2h1.26v-.77a2.33 2.33 0 0 1 1.46-2.14 2.36 2.36 0 0 1 2.59.47l.54.54.88-.88-.54-.55a2.34 2.34 0 0 1-.48-2.56 2.33 2.33 0 0 1 2.14-1.45H20v-1.29h-.77a2.33 2.33 0 0 1-2.14-1.46 2.36 2.36 0 0 1 .47-2.59l.54-.54-.88-.88-.55.54a2.39 2.39 0 0 1-4-1.67V4h-1.3v.77a2.33 2.33 0 0 1-1.46 2.14 2.36 2.36 0 0 1-2.59-.47l-.54-.54-.88.88.54.55a2.39 2.39 0 0 1-1.67 4H4v1.26h.77a2.33 2.33 0 0 1 2.14 1.46 2.36 2.36 0 0 1-.47 2.59l-.54.54.88.88.55-.54a2.39 2.39 0 0 1 4 1.67z" /><path d="M12 15.5a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5zm0-5a1.5 1.5 0 1 0 1.5 1.5 1.5 1.5 0 0 0-1.5-1.5z" /></svg>
  );
}

/** Ícones do menu da conta: traço único 1.75, 24×24 (mesma família da barra lateral). */
const ICON_PATHS = {
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  chevron: 'M6 9l6 6 6-6',
  register: 'M4 10h16v10H4zM7 10V5h10v5M8 14h2M14 14h2M8 17h8M10 7.5h4',
  banknote: 'M3 6.5h18v11H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 9.5v.01M18 14.5v.01',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3zM7.5 12.5v.01M9.5 8v.01M14.5 8v.01M17 11.5v.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  building: 'M4 21V5l8-2v18M12 21V9l8 2v10M2 21h20M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
} as const;

function MenuIcon({ d, size = 18, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className ?? 'acct2-ic'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

/** Menu da conta do gestor (canto superior direito): avatar + seta → nome,
 *  email, Configurações e Terminar sessão. Fecha ao clicar fora. */
function ManagerMenu({ photo, name, email, role, unread, custUnread, canCustChat, canOpenCash, canAdvances, advancesCount, onOpenCash, onChat, onCustChat, onAdvances, onSettings, onLogout, onCompany, onSubscription }: {
  photo: string | null; name: string; email: string; role: string; unread: number; custUnread: number; canCustChat: boolean; canOpenCash: boolean; canAdvances: boolean; advancesCount: number; onOpenCash(): void; onChat(): void; onCustChat(): void; onAdvances(): void; onSettings(): void; onLogout(): void;
  /** Dados da Empresa / Subscrição (só quando o utilizador tem acesso). */
  onCompany?: () => void; onSubscription?: () => void;
}) {
  const totalBadge = unread + (canCustChat ? custUnread : 0) + (canAdvances ? advancesCount : 0);
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const fs = useFullscreen();
  const [theme, setThemeState] = useState(getTheme());
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  // Troca de tema movida para AQUI (era um ícone na barra do topo): aplica na
  // hora e guarda a preferência na conta (segue o utilizador entre dispositivos).
  const pickTheme = (id: string) => {
    setTheme(id); setThemeState(id);
    api.preferences.setTheme(id).catch(() => { /* fica guardado localmente */ });
  };
  // Esc fecha o menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const shown = displayName(name, email);
  const go = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="acct acct2">
      <button className={`acct2-btn${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)} title={shown}
        aria-label={`Conta de ${shown}`} aria-haspopup="menu" aria-expanded={open}>
        <UserAvatar photo={photo} name={shown} email={email} size={34} />
        {totalBadge > 0 ? <span className="acct-badge">{totalBadge > 99 ? '99+' : totalBadge}</span> : null}
        <span className="acct2-id"><b>{shown}</b>{email ? <small>{email}</small> : null}</span>
        <MenuIcon d={ICON_PATHS.chevron} size={15} className="acct2-caret" />
      </button>
      {open ? (
        <div className="acct2-pop vd-prof" role="menu" aria-label="Conta">
          {/* Perfil no desenho de referência: avatar grande ao centro, nome e e-mail. */}
          <div className="vd-prof-head">
            <UserAvatar photo={photo} name={shown} email={email} size={64} />
            <div className="vd-prof-name">{shown}</div>
            {email ? <div className="vd-prof-email">{email}</div> : null}
            <div className="vd-prof-role">{role}</div>
          </div>
          <div className="vd-prof-group">
            <button role="menuitem" className="vd-prof-item" onClick={go(onSettings)}>
              <MenuIcon d={ICON_PATHS.lock} /> Alterar Password
            </button>
            <button role="menuitem" className="vd-prof-item" onClick={go(onSettings)}>
              <MenuIcon d={ICON_PATHS.hash} /> Alterar PIN
            </button>
            <button role="menuitem" className="vd-prof-item" onClick={go(() => setThemeOpen(true))}>
              <MenuIcon d={ICON_PATHS.palette} /> Tema do painel
            </button>
          </div>
          {/* Idioma do sistema (antes na barra do topo). */}
          <div className="vd-prof-group acct2-lang">
            <div className="acct2-lang-h"><IconGlobe size={16} /> Idioma</div>
            <LangChoice compact />
          </div>
          {canOpenCash || canAdvances ? (
            <div className="vd-prof-group">
              {canOpenCash ? (
                <button role="menuitem" className="vd-prof-item" onClick={go(onOpenCash)}>
                  <MenuIcon d={ICON_PATHS.register} /> Abrir caixa
                </button>
              ) : null}
              {canAdvances ? (
                <button role="menuitem" className="vd-prof-item" onClick={go(onAdvances)}>
                  <MenuIcon d={ICON_PATHS.banknote} /> Pedidos de adiantamento
                  {advancesCount > 0 ? <span className="acct-item-badge">{advancesCount > 99 ? '99+' : advancesCount}</span> : null}
                </button>
              ) : null}
            </div>
          ) : null}
          {onCompany || onSubscription ? (
            <div className="vd-prof-group">
              {onCompany ? (
                <button role="menuitem" className="vd-prof-item" onClick={go(onCompany)}>
                  <MenuIcon d={ICON_PATHS.building} /> Dados da Empresa
                </button>
              ) : null}
              {onSubscription ? (
                <button role="menuitem" className="vd-prof-item" onClick={go(onSubscription)}>
                  <MenuIcon d={ICON_PATHS.card} /> Subscrição
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="vd-prof-group">
            {fs.supported ? (
              <button role="menuitem" className="vd-prof-item" onClick={go(fs.toggle)}>
                <MenuIcon d={fs.on ? ICON_PATHS.shrink : ICON_PATHS.expand} /> {fs.on ? 'Diminuir' : 'Expandir'}
              </button>
            ) : null}
            <button role="menuitem" className="vd-prof-item" onClick={go(onLogout)}>
              <MenuIcon d={ICON_PATHS.logout} /> Terminar Sessão
            </button>
          </div>
        </div>
      ) : null}
      {themeOpen ? (
        <Modal title="Tema do painel" onClose={() => setThemeOpen(false)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            Escolhe o tema — aplica-se já e fica guardado na tua conta.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {THEMES.map((t) => {
              const on = theme === t.id;
              return (
                <button key={t.id || 'default'} type="button" onClick={() => pickTheme(t.id)}
                  className="acct-item" aria-pressed={on}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
                    border: `1.5px solid ${on ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 12,
                    background: on ? 'var(--primary-soft)' : 'var(--surface)' }}>
                  <span aria-hidden style={{ width: 22, height: 22, borderRadius: 999, flex: 'none',
                    background: t.swatch, boxShadow: '0 0 0 2px var(--border)' }} />
                  <span style={{ flex: 1, textAlign: 'left', fontWeight: 700 }}>{t.label}</span>
                  {on ? <span style={{ color: 'var(--primary)', fontWeight: 800 }}>✓</span> : null}
                </button>
              );
            })}
          </div>
          <button className="btn block" style={{ marginTop: 14 }} onClick={() => setThemeOpen(false)}>Concluído</button>
        </Modal>
      ) : null}
    </div>
  );
}

/** Nível de cada papel (0 = mais poder), igual ao backend (rbac/roles.enum). */
const ROLE_LEVEL: Record<string, number> = {
  SUPER_ADMIN: 0, COMPANY_ADMIN: 1, REGIONAL_MANAGER: 2, STORE_MANAGER: 3,
  SHIFT_SUPERVISOR: 4, CASHIER: 5, ATTENDANT: 6,
};
/** Chat com clientes: só supervisor e acima (NÃO operador de caixa nem atendente). */
function canChatCustomers(role?: string): boolean {
  return (ROLE_LEVEL[role ?? ''] ?? 6) <= ROLE_LEVEL.SHIFT_SUPERVISOR;
}

/** Item de navegação genérico (serve os dois painéis: plataforma e gestor). */
export interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Sub-opções (menu agrupado). Se presente, o item abre/fecha um grupo. */
  children?: NavItem[];
  /** Nível mínimo de papel para ver o item (0=mais poder). Omisso = visível a
   *  gerente de loja e acima. Itens sensíveis (subscrição, fiscal) usam 1. */
  min?: number;
}

/** Seta de expansão dos grupos do menu. */
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg width={14} height={14}
     
      style={{ marginLeft: 'auto', transition: 'transform .18s', transform: open ? 'rotate(90deg)' : 'none' }} viewBox="0 0 24 24" fill="currentColor"><path d="M10 19a1 1 0 0 1-.64-.23 1 1 0 0 1-.13-1.41L13.71 12 9.39 6.63a1 1 0 0 1 .15-1.41 1 1 0 0 1 1.46.15l4.83 6a1 1 0 0 1 0 1.27l-5 6A1 1 0 0 1 10 19z" /></svg>
  );
}

export function Shell({
  nav,
  section,
  setSection,
  roleLabel,
  subtitle,
  children,
}: {
  nav: NavItem[];
  section: string;
  setSection(s: string): void;
  roleLabel: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const { user, logout, companyCode } = useAuth();
  // Branding por empresa (tenant): logo + nome da própria empresa. Para o
  // super-admin (plataforma) mantém-se a marca do sistema.
  const isTenant = user?.subjectType === 'TENANT';
  const [brand, setBrand] = useState<{ name: string; logo: string | null; nif: string | null } | null>(null);
  useEffect(() => {
    if (!isTenant) { setBrand(null); return; }
    let alive = true;
    api.branding()
      .then((b) => { if (alive) setBrand({ name: b.brandName || b.companyName || SYSTEM_NAME, logo: b.logoUrl, nif: b.nif && !b.nif.startsWith('TMP') ? b.nif : null }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [isTenant]);
  // Foto do utilizador logado (avatar do menu da conta). Sem foto → ícone.
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.sub) { setAvatar(null); return; }
    let alive = true;
    // Mostra já a foto guardada no aparelho e confirma no servidor.
    setAvatar(cachedPhoto(user.email));
    const done = (p: string | null) => { if (!alive) return; setAvatar(p); rememberPhoto(user.email, p); };
    api.preferences.myPhoto()
      .then((r) => r.photoUrl ?? (isTenant
        ? api.staff.listUsers().then((list) => list.find((u) => u.id === user.sub)?.photo_url ?? null).catch(() => null)
        : null))
      .then(done)
      .catch(() => undefined);
    return () => { alive = false; };
  }, [isTenant, user?.sub, user?.email]);
  const brandName = brand?.name || SYSTEM_NAME;
  const brandLogo = brand?.logo || LOGO_SRC;
  // Procura o item activo, mesmo dentro de grupos.
  const flat = nav.flatMap((n) => (n.children ? n.children : [n]));
  const current = flat.find((n) => n.key === section);
  const has = (k: string) => flat.some((n) => n.key === k);
  const currentGroup = nav.find((n) => n.children?.some((c) => c.key === section)) ?? null;
  // Como no Vendus: o separador GESTÃO mostra SÓ a gestão. O que é do POS (caixas,
  // movimentos de caixa, tipos de pagamento), da LOJA (loja online, encomendas, LPS
  // Kwanza, comissões), das APPS (assistente, câmaras) ou da CONFIGURAÇÃO (subscrição,
  // equipa, backup, definições) fica apenas no respetivo separador — nenhum botão repetido.
  const FORA_DA_GESTAO = new Set(['assistant', 'subscription', 'stores-group', 'pos-group', 'operations', 'payments', 'cameras-group', 'backup-group', 'settings', 'users-group']);
  const navGestao = isTenant
    ? nav.filter((n) => !FORA_DA_GESTAO.has(n.key)).map((n) => (n.children ? { ...n, children: n.children.filter((c) => !FORA_DA_GESTAO.has(c.key)) } : n)).filter((n) => !n.children || n.children.length > 0)
    : nav;
  const userLevel = ROLE_LEVEL[user?.role ?? ''] ?? 9;
  // Criações rápidas do "+": só as secções que este papel vê na navegação.
  // Ordem e nomes como no "+" do backoffice de referência.
  const canPos = isTenant && userLevel <= ROLE_LEVEL.SHIFT_SUPERVISOR;
  const quick: QuickItem[] = ([
    ...(canPos ? [{ key: '__pos', label: 'Iniciar POS' }] : []),
    { key: 'documents', label: 'Documentos' },
    { key: 'products', label: 'Produto ou Serviço', create: true },
    { key: 'saft', label: 'Exportar SAF-T' },
    { key: 'customers', label: 'Cliente', create: true },
    { key: 'purchasing', label: 'Compra / Fornecedor' },
    { key: 'expenses', label: 'Gasto' },
    { key: 'employees', label: 'Funcionário' },
    { key: 'tenants', label: 'Empresa' },
  ] as QuickItem[]).filter((q) => q.key === '__pos' || has(q.key));
  const onQuick = (key: string) => {
    if (key === '__pos') { openCaixaTerminal({ staff: user?.email || '', nome: user?.name, empresa: companyCode || undefined }); return; }
    setSection(key);
  };
  const [menuOpen, setMenuOpen] = useState(false);
  // Como no Vendus: cada separador da coluna de ícones TROCA o menu ao lado
  // (Gestão, POS, Loja, Apps, Configuração) em vez de saltar para outra página.
  type RailTab = 'gestao' | 'pos' | 'loja' | 'apps' | 'config';
  const [railTab, setRailTab] = useState<RailTab>('gestao');
  // Menu fixo aberto (computador) — memorizado neste aparelho, como no Vendus.
  const [menuFixo, setMenuFixo] = useState<boolean>(() => { try { return localStorage.getItem('lps.menu.fixo') === '1'; } catch { return false; } });
  const alternarMenuFixo = () => setMenuFixo((v) => { const n = !v; try { localStorage.setItem('lps.menu.fixo', n ? '1' : '0'); } catch { /* sem armazenamento */ } return n; });
  // Grupos abertos (abre automaticamente o que contém a secção activa).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Como no Vendus: o grupo da página ATIVA fica aberto (vê-se onde se está). Fechar
  // por fora / sair com o rato volta a esse estado em vez de fechar tudo.
  const grupoAtualKey = nav.find((n) => n.children?.some((c) => c.key === section))?.key;
  const reporGrupos = () => setOpenGroups(grupoAtualKey ? { [grupoAtualKey]: true } : {});
  useEffect(() => { reporGrupos(); }, [grupoAtualKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chat de equipa (gestor ↔ caixa): badge de não-lidas + janela.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  // Chat com clientes da loja online — só supervisor e acima.
  const [custChatOpen, setCustChatOpen] = useState(false);
  const [custUnread, setCustUnread] = useState(0);
  const custChatAllowed = canChatCustomers(user?.role);
  // Pedidos de adiantamento salarial — sub-botão do perfil (gestor/gerente).
  const advancesAllowed = isTenant && (ROLE_LEVEL[user?.role ?? ''] ?? 9) <= ROLE_LEVEL.STORE_MANAGER;
  const advances = useAdvances(advancesAllowed);
  const [advancesOpen, setAdvancesOpen] = useState(false);
  useEffect(() => {
    if (!isTenant) return;
    let alive = true;
    const tick = () => {
      api.chat.unread().then((r) => { if (alive) setChatUnread(r.count); }).catch(() => undefined);
      if (custChatAllowed) api.customerChat.unread().then((r) => { if (alive) setCustUnread(r.count); }).catch(() => undefined);
    };
    tick();
    const t = pollEvery(tick, 10000);
    return () => { alive = false; stopPoll(t); };
  }, [isTenant, custChatAllowed]);

  // Cada botão dos painéis tem ícone, como no Vendus (Eva Icons).
  type PanelItem = { key: string; label: string; act?: () => void; on?: boolean; icon?: React.ComponentType<{ size?: number }>; cta?: boolean; head?: string };
  // Abre as Configurações num separador concreto (como os itens do painel CONFIG do Vendus).
  const abrirDefinicoes = (tab: 'brand' | 'modules' | 'stock') => {
    try { sessionStorage.setItem('lps.settings.tab', tab); } catch { /* sem armazenamento */ }
    window.dispatchEvent(new CustomEvent('lps:settings-tab', { detail: tab }));
    setSection('settings');
  };
  const abrirHistorico = () => {
    try { sessionStorage.setItem('lps.sub.focus', 'history'); } catch { /* sem armazenamento */ }
    window.dispatchEvent(new Event('lps:sub-history'));
    setSection('subscription');
  };
  const pi = (key: string, label?: string, icon?: PanelItem['icon']): PanelItem | null => {
    const it = flat.find((n) => n.key === key);
    return it ? { key, label: label ?? it.label ?? key, icon: icon ?? it.icon } : null;
  };
  const abrirApps = () => { if (has('downloads')) setSection('downloads'); else window.open('/baixar', '_blank'); };
  const equipa = (nav.find((n) => n.key === 'users-group')?.children ?? []).map((c) => ({ key: c.key, label: c.label, icon: c.icon }));
  const paineis: Record<Exclude<RailTab, 'gestao'>, PanelItem[]> = {
    pos: [
      // Como no Vendus: «Iniciar Ponto de Venda» é um botão azul destacado e as apps
      // ficam numa secção «DOWNLOADS» no fim do painel.
      canPos ? { key: '__pos', label: 'Iniciar Ponto de Venda', act: () => onQuick('__pos'), icon: IconCashRegister, cta: true } : null,
      pi('operations', 'Movimentos de Caixa', IconHistory), pi('registers', 'Caixas', IconStore), pi('payments', 'Tipos de Pagamento', IconCard),
      { key: '__apps-win', label: 'LPS Vendas Windows', act: abrirApps, icon: IconDownload, head: 'Downloads' },
      { key: '__apps-android', label: 'App Caixa Android', act: abrirApps, icon: IconDownload },
    ].filter(Boolean) as PanelItem[],
    loja: [
      pi('orders', 'Encomendas'),
      pi('store', 'Loja online'),
      isTenant && !has('store') ? { key: '__loja', label: 'Abrir a loja online', act: () => { window.open(`${STORE_URL}/${companyCode ?? ''}`, '_blank'); }, icon: IconStore } : null,
      pi('kwanza'), pi('commissions'), pi('kwanza-payouts'),
    ].filter(Boolean) as PanelItem[],
    apps: [
      { key: '__baixar', label: 'Aplicações', act: abrirApps, icon: IconDownload },
      pi('assistant'), pi('cameras-live', 'Câmaras'), pi('cameras-config', 'Configurar câmaras'), pi('cameras-map', 'Olho de Deus'),
      pi('gateways'), pi('ai'),
    ].filter(Boolean) as PanelItem[],
    // Mesma ordem do painel CONFIG do Vendus; depois o que é só do LPS.
    config: [
      has('settings') ? { key: '__dados', label: 'Dados da Empresa', act: () => abrirDefinicoes('brand'), icon: IconBuilding } : null,
      has('settings') ? { key: '__definicoes', label: 'Definições', act: () => abrirDefinicoes('modules'), icon: EvaGear } : null,
      has('settings') ? { key: '__stock', label: 'Stock', act: () => abrirDefinicoes('stock'), icon: IconBoxes } : null,
      pi('subscription', 'Subscrição'),
      has('subscription') ? { key: '__historico', label: 'Histórico de Pagamentos', act: abrirHistorico, icon: IconHistory } : null,
      pi('migration', 'Migração de Dados'),
      pi('integrations', 'Integrações'),
      pi('stores', 'Lojas e Caixas', IconStore),
      ...equipa,
      pi('security'), pi('mail'), pi('backup'), pi('backup-restore', 'Restauro de backup'),
      { key: 'profile', label: 'O meu perfil', icon: EvaUser },
    ].filter(Boolean) as PanelItem[],
  };
  const painel = railTab === 'gestao' ? null : paineis[railTab];
  // Ao entrar (ou ao abrir uma secção por um atalho), o separador certo fica ativo:
  // ex.: estando em «Caixas», o menu mostra o painel POS e não a Gestão.
  const gestaoKeys = navGestao.flatMap((n) => (n.children ? n.children.map((c) => c.key) : [n.key]));
  useEffect(() => {
    if (!isTenant) return;
    if (railTab !== 'gestao' && paineis[railTab].some((p) => p.key === section)) return; // já está no separador certo
    if (gestaoKeys.includes(section)) { setRailTab('gestao'); return; }
    const alvo = (['pos', 'loja', 'apps', 'config'] as const).find((t) => paineis[t].some((p) => p.key === section));
    if (alvo) setRailTab(alvo);
  }, [section, isTenant]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fecha a gaveta ao mudar de secção (importante no telemóvel).
  useEffect(() => { setMenuOpen(false); }, [section]);
  // Nome da empresa SEMPRE inteiro (pode ocupar várias linhas): a altura real do
  // cabeçalho do menu entra nas contas das linhas, para o menu continuar a caber sem scroll.
  const brandRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = brandRef.current; const aside = asideRef.current;
    if (!el || !aside || typeof ResizeObserver === 'undefined') return;
    // Nome numa só linha, inteiro: se não couber, a letra encolhe até caber (sem cortar nem quebrar).
    const fit = (t: HTMLElement | null, max: number) => {
      if (!t) return;
      t.style.fontSize = '';
      const w = t.clientWidth;
      if (w > 0 && t.scrollWidth > w) t.style.fontSize = `${Math.max(7, Math.floor((max * w / t.scrollWidth) * 10) / 10)}px`;
    };
    const set = () => {
      fit(el.querySelector<HTMLElement>('.nm'), 14);
      fit(el.querySelector<HTMLElement>('.tg'), 11);
      aside.style.setProperty('--brand-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    };
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    const tx = el.querySelector('.brand-tx'); if (tx) ro.observe(tx);
    return () => ro.disconnect();
  }, [brandName, brand?.nif]);
  // Fecha os grupos abertos ao clicar FORA da barra lateral.
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!Object.values(openGroups).some(Boolean)) return;
    const onDoc = (e: MouseEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node) && Object.keys(openGroups).some((k) => openGroups[k] && k !== grupoAtualKey)) reporGrupos();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openGroups]);

  return (
    <div className={`admin nav-rail${menuFixo ? ' menu-fixo' : ''}`}>
      {menuOpen ? <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} /> : null}
      {/* Barra lateral estilo Vendus: coluna de ícones (GESTÃO, POS, LOJA, APPS,
          Configurações) + menu da gestão, que mostra só os ícones e abre ao passar
          o rato (animação do LPS). Sem scroll: as linhas encolhem para caber. */}
      <aside ref={asideRef} className={`sidebar vds${menuOpen ? ' open' : ''}`} onMouseLeave={reporGrupos}
        style={{
          ['--nav-n' as string]: painel ? Math.max(painel.length + painel.filter((p) => p.head).length, 6) : navGestao.length + navGestao.reduce((s, n) => s + (openGroups[n.key] ? (n.children?.length ?? 0) : 0), 0),
          // Telemóvel: com um grupo aberto o menu mostra SÓ esse grupo (cabeçalho
          // + itens), como o menu do Vendus — as linhas cabem sempre, sem scroll.
          ['--nav-m' as string]: painel ? Math.max(painel.length + painel.filter((p) => p.head).length, 6) : (() => { const g = navGestao.find((n) => openGroups[n.key] && n.children?.length); return g ? (g.children!.length + 1) : navGestao.length; })(),
        }}>
        <div className="vds-rail" aria-label="Aplicações">
          <span className="vds-logo"><img src={brandLogo} alt={brandName} onError={(e) => { (e.target as HTMLImageElement).src = LOGO_SRC; }} /></span>
          <button type="button" className={`vds-tab${railTab === 'gestao' ? ' on' : ''}`} title="Gestão" onClick={() => { setRailTab('gestao'); reporGrupos(); }}>
            <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" /><rect x="13" y="3" width="8" height="5" rx="2" fill="currentColor" opacity=".55" /><rect x="13" y="10" width="8" height="11" rx="2" fill="currentColor" /><rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".55" /></svg>
            <span>GESTÃO</span>
          </button>
          {canPos ? (
            <button type="button" className={`vds-tab${railTab === 'pos' ? ' on' : ''}`} title="Ponto de Venda" onClick={() => setRailTab('pos')}>
              <svg viewBox="0 0 24 24" aria-hidden><rect x="2.5" y="3.5" width="19" height="13" rx="2" fill="currentColor" /><rect x="9" y="18" width="6" height="2.5" rx="1" fill="currentColor" opacity=".6" /></svg>
              <span>POS</span>
            </button>
          ) : null}
          {isTenant ? (
            <button type="button" className={`vds-tab${railTab === 'loja' ? ' on' : ''}`} title="Loja online" onClick={() => setRailTab('loja')}>
              <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M5 7h14l-1 13a1.5 1.5 0 0 1-1.5 1.4h-9A1.5 1.5 0 0 1 6 20L5 7Z" /><path fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" d="M9 10.5a3 3 0 0 0 6 0" /></svg>
              <span>LOJA</span>
            </button>
          ) : null}
          <button type="button" className={`vds-tab${railTab === 'apps' ? ' on' : ''}`} title="Aplicações" onClick={() => setRailTab('apps')}>
            <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="m12 2.5 9 4.6-9 4.6-9-4.6 9-4.6Z" /><path fill="currentColor" opacity=".7" d="m3 11.2 9 4.6 9-4.6v2.4l-9 4.6-9-4.6v-2.4Z" /><path fill="currentColor" opacity=".45" d="m3 15.6 9 4.6 9-4.6V18l-9 4.6L3 18v-2.4Z" /></svg>
            <span>APPS</span>
          </button>
          <span className="vds-spacer" />
          <button type="button" className={`vds-gear${railTab === 'config' ? ' on' : ''}`} title="Configuração"
            onClick={() => setRailTab('config')}>
            <IconGear size={19} />
          </button>
        </div>
        <div className="vds-menu">
          <div className="brand vds-company" ref={brandRef}>
            <div className="brand-tx">
              <div className="nm">{brandName}</div>
              <div className="tg">{brand?.nif ? `NIF: ${brand.nif}` : subtitle}</div>
            </div>
            <button type="button" className={`vds-pin${menuFixo ? ' on' : ''}`} onClick={alternarMenuFixo}
              title={menuFixo ? 'Recolher o menu' : 'Fixar o menu aberto'} aria-pressed={menuFixo}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={menuFixo ? 'M9 7l-5 5 5 5' : 'M4 7l5 5-5 5'} /><path d="M13 6h7M13 12h7M13 18h7" />
              </svg>
            </button>
          </div>
          <nav className={`nav${!painel && navGestao.some((n) => openGroups[n.key] && n.children?.length) ? ' has-open' : ''}${painel ? ' nav-painel' : ''}`} key={railTab}>
            {painel ? painel.map((p) => (
              <React.Fragment key={p.key}>
                {p.head ? <div className="vds-sec" role="presentation">{p.head}</div> : null}
                <button className={`${section === p.key ? 'active' : ''}${p.cta ? ' vds-cta' : ''}`} title={p.label}
                  onClick={() => { if (p.act) p.act(); else setSection(p.key); setMenuOpen(false); }}>
                  {p.icon ? <p.icon size={18} /> : null}<span className="nav-label">{p.label}</span>
                </button>
              </React.Fragment>
            )) : navGestao.map((n) => {
              const Icon = n.icon;
              if (n.children && n.children.length) {
                const open = !!openGroups[n.key];
                const hasActive = n.children.some((c) => c.key === section);
                return (
                  <div key={n.key} className={`nav-group${open ? ' is-open' : ''}`}>
                    <button
                      className={`nav-group-head${hasActive ? ' has-active' : ''}`}
                      title={n.label}
                      onClick={() => {
                        setOpenGroups((p) => (p[n.key] ? {} : { [n.key]: true }));
                      }}
                    >
                      <Icon size={18} /> <span className="nav-label">{n.label}</span>
                      <IconChevron open={open} />
                    </button>
                    {open ? (
                      <div className="nav-sub">
                        {n.children.map((c) => {
                          const CIcon = c.icon;
                          return (
                            <button
                              key={c.key}
                              className={section === c.key ? 'active' : ''}
                              onClick={() => { setSection(c.key); setOpenGroups({ [n.key]: true }); setMenuOpen(false); }}
                            >
                              <CIcon size={16} /> {c.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }
              return (
                <button
                  key={n.key}
                  className={section === n.key ? 'active' : ''}
                  title={n.label}
                  onClick={() => { setSection(n.key); setMenuOpen(false); }}
                >
                  <Icon size={18} /> <span className="nav-label">{n.label}</span>
                </button>
              );
            })}
          </nav>
          {/* Como no Vendus: linha "Configuração" no fundo, alinhada com a roda dentada. */}
          <button type="button" className={`vds-cfg${railTab === 'config' ? ' on' : ''}`} title={copyrightLine()} onClick={() => setRailTab('config')}>
            Configuração
          </button>
        </div>
      </aside>

      <div className="main" data-crumb={current?.label ?? ''}>
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            <IconMenu size={22} />
          </button>
          {/* Padrão do backoffice de referência: título da página à esquerda;
              subscrição, AGT, "+" e "?" e a conta à direita, separados por divisórias. */}
          <TopTitle title={current?.label ?? (section === 'profile' ? 'Perfil' : brandName)} />
          <span className="spacer" />
          <SubscriptionRing enabled={isTenant} onGo={has('subscription') ? () => setSection('subscription') : undefined} />
          <AgtStatus
            mode={!isTenant ? (has('fiscal') ? 'platform' : 'none') : userLevel <= ROLE_LEVEL.STORE_MANAGER ? 'tenant' : 'badge'}
            onGo={() => setSection(isTenant ? (has('saft') ? 'saft' : section) : 'fiscal')}
          />
          <TopDivider />
          <TopActions quick={quick} help={has('assistant') ? 'assistant' : has('support') ? 'support' : null} onGo={onQuick} />
          <TopDivider />
          <SyncStatusPill />
          {!isTenant ? <NotifyBell onGo={(s) => setSection(s)} /> : null}
          {isTenant ? <NotificationCenter onGo={(s) => setSection(s)} /> : null}
          {/* Chats visíveis na barra (antes escondidos no menu do perfil):
              chat com a caixa e chat com clientes — cada um com badge de não-lidas. */}
          {isTenant ? (
            <button className="icon-btn tb-chat" style={{ position: 'relative' }} onClick={() => setChatOpen(true)} title="Chat com a caixa" aria-label="Chat com a caixa">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              {isTenant && chatUnread > 0 ? <span className="noti-badge">{chatUnread > 99 ? '99+' : chatUnread}</span> : null}
            </button>
          ) : null}
          {isTenant && custChatAllowed ? (
            <button className="icon-btn tb-chat" style={{ position: 'relative' }} onClick={() => setCustChatOpen(true)} title="Chat com clientes" aria-label="Chat com clientes">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M20.12 6.71l-2.83-2.83A3 3 0 0 0 15.17 3H8.83a3 3 0 0 0-2.12.88L3.88 6.71A3 3 0 0 0 3 8.83V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8.83a3 3 0 0 0-.88-2.12zm-12-1.42A1.05 1.05 0 0 1 8.83 5h6.34a1.05 1.05 0 0 1 .71.29L17.59 7H6.41zM18 19H6a1 1 0 0 1-1-1V9h14v9a1 1 0 0 1-1 1z" /><path d="M15 11a1 1 0 0 0-1 1 2 2 0 0 1-4 0 1 1 0 0 0-2 0 4 4 0 0 0 8 0 1 1 0 0 0-1-1z" /></svg>
              {custUnread > 0 ? <span className="noti-badge">{custUnread > 99 ? '99+' : custUnread}</span> : null}
            </button>
          ) : null}
          <ManagerMenu
            photo={avatar}
            name={user?.name || user?.email || 'Gestor'}
            email={user?.email || ''}
            role={`${roleLabel}${companyCode ? ` · ${companyCode}` : ''}`}
            unread={isTenant ? chatUnread : 0}
            custUnread={isTenant ? custUnread : 0}
            canCustChat={isTenant && custChatAllowed}
            canAdvances={advancesAllowed}
            advancesCount={advances.items.length}
            onAdvances={() => setAdvancesOpen(true)}
            canOpenCash={isTenant && (ROLE_LEVEL[user?.role ?? ''] ?? 9) <= ROLE_LEVEL.SHIFT_SUPERVISOR}
            onOpenCash={() => openCaixaTerminal({
              staff: user?.email || '',
              nome: user?.name,
              empresa: companyCode || undefined,
            })}
            onChat={() => setChatOpen(true)}
            onCustChat={() => setCustChatOpen(true)}
            onSettings={() => setSection('profile')}
            onCompany={isTenant && has('settings') ? () => setSection('settings') : undefined}
            onSubscription={isTenant && has('subscription') ? () => setSection('subscription') : undefined}
            onLogout={logout}
          />
        </header>
        <div className="content"><div className="page-anim" key={section} data-sec={section}>
          {/* Breadcrumb do padrão de referência ("Grupo / Página"); as ações do
              cabeçalho da página ficam na mesma linha, à direita. */}
          <div className="vd-crumbbar no-print">
            <p className="vd-crumb">
              {currentGroup ? <><button onClick={() => setOpenGroups({ [currentGroup.key]: true })}>{currentGroup.label}</button><span className="sep">/</span></> : null}
              <span>{current?.label ?? (section === 'profile' ? 'Perfil' : '')}</span>
            </p>
          </div>
          <PrintBrandHead title={current?.label} />
          {children}
          <PrintBrandFoot />
        </div></div>
      </div>
      {chatOpen ? (
        <ChatModal meId={user?.sub} title="Chat com a caixa" onClose={() => setChatOpen(false)} onRead={() => setChatUnread(0)} />
      ) : null}
      {custChatOpen && custChatAllowed ? (
        <CustomerChatModal onClose={() => setCustChatOpen(false)} onRead={() => setCustUnread(0)} />
      ) : null}
      {advancesOpen && advancesAllowed ? (
        <AdvancesModal items={advances.items} onReview={advances.review} onClose={() => setAdvancesOpen(false)} />
      ) : null}
      <IdleLock
        photo={avatar}
        name={user?.name || user?.email || 'Utilizador'}
        role={`${roleLabel}${companyCode ? ` · ${companyCode}` : ''}`}
      />
    </div>
  );
}
