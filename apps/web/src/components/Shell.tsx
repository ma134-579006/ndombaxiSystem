import React, { useEffect, useRef, useState } from 'react';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { IconLogout } from './Icons';
import { THEMES, getTheme, setTheme } from '../theme';
import { PrintBrandHead, PrintBrandFoot } from './PrintBrand';
import { ChatModal } from './ChatModal';
import { CustomerChatModal } from './CustomerChatModal';
import { IdleLock } from './IdleLock';
import { SyncStatusPill } from '../offline/SyncStatusPill';
import { Modal } from './ui';
import { UserAvatar, displayName } from './UserAvatar';
import type { SalaryAdvanceReq } from '../api/types';
import { openCaixaTerminal } from '../config';

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
    const t = window.setInterval(tick, 20000);
    return () => { alive = false; window.clearInterval(t); };
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
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
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

/** Sino de PEDIDOS DA LOJA (gestor): encomendas novas + pedidos de serviço +
 *  reservas vindas da loja online. Badge soma os três; clicar abre a secção mais
 *  relevante (encomendas → ordens de serviço → reservas). */
function OrdersBell({ onGo }: { onGo(section: string): void }) {
  const [orders, setOrders] = useState(0);
  const [services, setServices] = useState(0);
  const [rooms, setRooms] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      api.orders.pendingCount().then((r) => { if (alive) setOrders(r.count); }).catch(() => undefined);
      api.serviceOrders.pendingOnline().then((r) => { if (alive) setServices(r.count); }).catch(() => undefined);
      api.hotel.pendingOnline().then((r) => { if (alive) setRooms(r.count); }).catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 15000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  const n = orders + services + rooms;
  const target = orders > 0 ? 'orders' : services > 0 ? 'service-orders' : rooms > 0 ? 'hotel' : 'orders';
  return (
    <button className="icon-btn noti-btn" onClick={() => onGo(target)}
      title={n > 0 ? `${n} pedido(s) novo(s) da loja` : 'Pedidos da loja'} aria-label="Pedidos da loja">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 ? <span className="noti-badge">{n > 99 ? '99+' : n}</span> : null}
    </button>
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
    const t = window.setInterval(tick, 20000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener('focus', onFocus); };
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

/** Ícone de utilizador (placeholder do avatar quando não há foto). */
function IconUser({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function IconGear({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Ícones do menu da conta: traço único 1.75, 24×24 (mesma família da barra lateral). */
const ICON_PATHS = {
  chevron: 'M6 9l6 6 6-6',
  register: 'M4 10h16v10H4zM7 10V5h10v5M8 14h2M14 14h2M8 17h8M10 7.5h4',
  banknote: 'M3 6.5h18v11H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 9.5v.01M18 14.5v.01',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3zM7.5 12.5v.01M9.5 8v.01M14.5 8v.01M17 11.5v.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
} as const;

function MenuIcon({ d, size = 18, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className ?? 'acct2-ic'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

/** Menu da conta do gestor (canto superior direito): avatar + seta → nome,
 *  email, Configurações e Terminar sessão. Fecha ao clicar fora. */
function ManagerMenu({ photo, name, email, role, unread, custUnread, canCustChat, canOpenCash, canAdvances, advancesCount, onOpenCash, onChat, onCustChat, onAdvances, onSettings, onLogout }: {
  photo: string | null; name: string; email: string; role: string; unread: number; custUnread: number; canCustChat: boolean; canOpenCash: boolean; canAdvances: boolean; advancesCount: number; onOpenCash(): void; onChat(): void; onCustChat(): void; onAdvances(): void; onSettings(): void; onLogout(): void;
}) {
  const totalBadge = unread + (canCustChat ? custUnread : 0) + (canAdvances ? advancesCount : 0);
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
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
        <MenuIcon d={ICON_PATHS.chevron} size={15} className="acct2-caret" />
      </button>
      {open ? (
        <div className="acct2-pop" role="menu" aria-label="Conta">
          <div className="acct2-head">
            <UserAvatar photo={photo} name={shown} email={email} size={44} />
            <div className="acct2-who">
              <div className="acct2-name">{shown}</div>
              {email ? <div className="acct2-email">{email}</div> : null}
            </div>
          </div>
          <div className="acct2-role">{role}</div>
          <div className="acct2-group">
            {canOpenCash ? (
              <button role="menuitem" className="acct2-item" onClick={go(onOpenCash)}>
                <MenuIcon d={ICON_PATHS.register} /> Abrir caixa
              </button>
            ) : null}
            {canAdvances ? (
              <button role="menuitem" className="acct2-item" onClick={go(onAdvances)}>
                <MenuIcon d={ICON_PATHS.banknote} /> Pedidos de adiantamento
                {advancesCount > 0 ? <span className="acct-item-badge">{advancesCount > 99 ? '99+' : advancesCount}</span> : null}
              </button>
            ) : null}
            <button role="menuitem" className="acct2-item" onClick={go(() => setThemeOpen(true))}>
              <MenuIcon d={ICON_PATHS.palette} /> Tema do painel
            </button>
            <button role="menuitem" className="acct2-item" onClick={go(onSettings)}>
              <MenuIcon d={ICON_PATHS.settings} /> Configurações
            </button>
          </div>
          <div className="acct2-group">
            <button role="menuitem" className="acct2-item danger" onClick={go(onLogout)}>
              <MenuIcon d={ICON_PATHS.logout} /> Terminar sessão
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
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ marginLeft: 'auto', transition: 'transform .18s', transform: open ? 'rotate(90deg)' : 'none' }}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
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
  const [brand, setBrand] = useState<{ name: string; logo: string | null } | null>(null);
  useEffect(() => {
    if (!isTenant) { setBrand(null); return; }
    let alive = true;
    api.branding()
      .then((b) => { if (alive) setBrand({ name: b.brandName || b.companyName || SYSTEM_NAME, logo: b.logoUrl }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [isTenant]);
  // Foto do utilizador logado (avatar do menu da conta). Sem foto → ícone.
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!isTenant || !user?.sub) { setAvatar(null); return; }
    let alive = true;
    api.staff.listUsers()
      .then((list) => { const me = list.find((u) => u.id === user.sub); if (alive) setAvatar(me?.photo_url ?? null); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [isTenant, user?.sub]);
  const brandName = brand?.name || SYSTEM_NAME;
  const brandLogo = brand?.logo || LOGO_SRC;
  // Procura o item activo, mesmo dentro de grupos.
  const flat = nav.flatMap((n) => (n.children ? n.children : [n]));
  const current = flat.find((n) => n.key === section);
  const [menuOpen, setMenuOpen] = useState(false);
  // Grupos abertos (abre automaticamente o que contém a secção activa).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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
    const t = window.setInterval(tick, 10000);
    return () => { alive = false; window.clearInterval(t); };
  }, [isTenant, custChatAllowed]);

  // Fecha a gaveta ao mudar de secção (importante no telemóvel).
  useEffect(() => { setMenuOpen(false); }, [section]);
  // Fecha os grupos abertos ao clicar FORA da barra lateral.
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!Object.values(openGroups).some(Boolean)) return;
    const onDoc = (e: MouseEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setOpenGroups({});
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openGroups]);

  return (
    <div className="admin nav-rail">
      {menuOpen ? <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} /> : null}
      <aside ref={asideRef} className={`sidebar${menuOpen ? ' open' : ''}`} onMouseLeave={() => setOpenGroups({})}>
        <div className="brand">
          <img src={brandLogo} alt={brandName} onError={(e) => { (e.target as HTMLImageElement).src = LOGO_SRC; }} />
          <div className="brand-tx">
            <div className="nm">{brandName}</div>
            <div className="tg">{subtitle}</div>
          </div>
        </div>
        <nav className="nav">
          {nav.map((n) => {
            const Icon = n.icon;
            if (n.children && n.children.length) {
              const open = !!openGroups[n.key];
              const hasActive = n.children.some((c) => c.key === section);
              return (
                <div key={n.key} className="nav-group">
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
                            onClick={() => { setSection(c.key); setOpenGroups({}); }}
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
                onClick={() => setSection(n.key)}
              >
                <Icon size={18} /> <span className="nav-label">{n.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sig">{copyrightLine()}</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            <IconMenu size={22} />
          </button>
          {/* Sem título duplicado na barra: cada página já mostra o seu nome
              no cabeçalho do conteúdo (padrão enterprise — a barra é só ações). */}
          <span className="spacer" />
          <SyncStatusPill />
          {!isTenant ? <NotifyBell onGo={(s) => setSection(s)} /> : null}
          {isTenant ? <OrdersBell onGo={(s) => setSection(s)} /> : null}
          {/* Chats visíveis na barra (antes escondidos no menu do perfil):
              chat com a caixa e chat com clientes — cada um com badge de não-lidas. */}
          {isTenant ? (
            <button className="icon-btn" style={{ position: 'relative' }} onClick={() => setChatOpen(true)} title="Chat com a caixa" aria-label="Chat com a caixa">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              {isTenant && chatUnread > 0 ? <span className="noti-badge">{chatUnread > 99 ? '99+' : chatUnread}</span> : null}
            </button>
          ) : null}
          {isTenant && custChatAllowed ? (
            <button className="icon-btn" style={{ position: 'relative' }} onClick={() => setCustChatOpen(true)} title="Chat com clientes" aria-label="Chat com clientes">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 4 6v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6l-2-4H6z" /><path d="M4 6h16" /><path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
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
            onLogout={logout}
          />
        </header>
        <div className="content"><div className="page-anim" key={section}>
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
