import React, { useEffect, useRef, useState } from 'react';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { IconLogout } from './Icons';
import { ThemePicker } from './ThemePicker';
import { PrintBrandHead, PrintBrandFoot } from './PrintBrand';
import { ChatModal } from './ChatModal';
import { CustomerChatModal } from './CustomerChatModal';
import { Modal } from './ui';
import type { SalaryAdvanceReq } from '../api/types';
import { CAIXA_URL } from '../config';

/** Sino de notificações (Super Admin): conversas por responder + comentários
 *  novos do site — com badge e dropdown estilo rede social. */
function NotifyBell({ onGo }: { onGo(section: string): void }) {
  const [n, setN] = useState<{ unreadChats: number; humanWaiting: number; newFeedback: number } | null>(null);
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
  const total = (n?.unreadChats ?? 0) + (n?.newFeedback ?? 0);
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
            💬 <span style={{ flex: 1, textAlign: 'left' }}>
              {n?.unreadChats ? <><strong>{n.unreadChats}</strong> conversa(s) por responder{n.humanWaiting ? ` · ${n.humanWaiting} à espera da equipa` : ''}</> : 'Sem conversas novas'}
            </span>
            {n?.unreadChats ? <span className="noti-badge inline">{n.unreadChats}</span> : null}
          </button>
          <button className="noti-item" onClick={() => { setOpen(false); onGo('feedback'); }}>
            ⭐ <span style={{ flex: 1, textAlign: 'left' }}>
              {n?.newFeedback ? <><strong>{n.newFeedback}</strong> comentário(s) novo(s) no site</> : 'Sem comentários novos'}
            </span>
            {n?.newFeedback ? <span className="noti-badge inline">{n.newFeedback}</span> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Sino de ENCOMENDAS (gestor): avisa quando há encomendas novas (PENDING) da
 *  loja online. Badge estilo rede social; clicar abre a secção Encomendas. */
function OrdersBell({ onGo }: { onGo(): void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = () => { api.orders.pendingCount().then((r) => { if (alive) setN(r.count); }).catch(() => undefined); };
    tick();
    const t = window.setInterval(tick, 15000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  return (
    <button className="icon-btn noti-btn" onClick={onGo}
      title={n > 0 ? `${n} encomenda(s) nova(s) da loja` : 'Encomendas da loja'} aria-label="Encomendas da loja">
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
    <Modal title="💸 Pedidos de adiantamento" onClose={onClose}>
      <div className="adv-list">
        {items.length === 0 ? (
          <div className="adv-empty">Sem pedidos de adiantamento pendentes.</div>
        ) : items.map((a) => (
          <div key={a.id} className="adv-req">
            <div className="adv-req-top">
              <strong className="adv-req-name">{a.staff_name}</strong>
              <strong className="adv-req-amt">{fmtKz(Number(a.amount))}</strong>
            </div>
            <div className="adv-req-meta">
              {a.monthly_pay ? `Salário ${fmtKz(Number(a.monthly_pay))}` : 'Salário n/d'}
              {' · '}{new Date(a.requested_at).toLocaleDateString('pt-PT')}
              {a.reason ? ` · ${a.reason}` : ''}
            </div>
            <div className="adv-req-actions">
              <button className="btn sm ok" disabled={busy === a.id} onClick={() => void act(a.id, 'APPROVED')}>Aceitar</button>
              <button className="btn sm ghost danger" disabled={busy === a.id} onClick={() => void act(a.id, 'REJECTED')}>Rejeitar</button>
            </div>
          </div>
        ))}
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

/** Menu da conta do gestor (canto superior direito): avatar + seta → nome,
 *  email, Configurações e Terminar sessão. Fecha ao clicar fora. */
function ManagerMenu({ photo, name, email, role, unread, custUnread, canCustChat, canOpenCash, canAdvances, advancesCount, onOpenCash, onChat, onCustChat, onAdvances, onSettings, onLogout }: {
  photo: string | null; name: string; email: string; role: string; unread: number; custUnread: number; canCustChat: boolean; canOpenCash: boolean; canAdvances: boolean; advancesCount: number; onOpenCash(): void; onChat(): void; onCustChat(): void; onAdvances(): void; onSettings(): void; onLogout(): void;
}) {
  const totalBadge = unread + (canCustChat ? custUnread : 0) + (canAdvances ? advancesCount : 0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="acct">
      <button className="acct-btn" onClick={() => setOpen((v) => !v)} title={name} aria-label="Conta">
        {photo ? <img className="acct-av" src={photo} alt={name} /> : <span className="acct-av acct-av-ph"><IconUser size={18} /></span>}
        {totalBadge > 0 ? <span className="acct-badge">{totalBadge > 99 ? '99+' : totalBadge}</span> : null}
        <span className={`acct-caret${open ? ' up' : ''}`}>▾</span>
      </button>
      {open ? (
        <div className="acct-pop">
          <div className="acct-head">
            {photo ? <img className="acct-av lg" src={photo} alt={name} /> : <span className="acct-av lg acct-av-ph"><IconUser size={22} /></span>}
            <div style={{ minWidth: 0 }}>
              <div className="acct-name">{name}</div>
              {email ? <div className="acct-email">{email}</div> : null}
              <div className="acct-role">{role}</div>
            </div>
          </div>
          {canOpenCash ? (
            <button className="acct-item" onClick={() => { setOpen(false); onOpenCash(); }}>
              <span style={{ fontSize: 16, width: 17, display: 'inline-grid', placeItems: 'center' }}>🛒</span> Abrir caixa
            </button>
          ) : null}
          <button className="acct-item" onClick={() => { setOpen(false); onChat(); }}>
            <span style={{ fontSize: 16, width: 17, display: 'inline-grid', placeItems: 'center' }}>💬</span> Chat com caixa
            {unread > 0 ? <span className="acct-item-badge">{unread > 99 ? '99+' : unread}</span> : null}
          </button>
          {canCustChat ? (
            <button className="acct-item" onClick={() => { setOpen(false); onCustChat(); }}>
              <span style={{ fontSize: 16, width: 17, display: 'inline-grid', placeItems: 'center' }}>🛍️</span> Chat com clientes
              {custUnread > 0 ? <span className="acct-item-badge">{custUnread > 99 ? '99+' : custUnread}</span> : null}
            </button>
          ) : null}
          {canAdvances ? (
            <button className="acct-item" onClick={() => { setOpen(false); onAdvances(); }}>
              <span style={{ fontSize: 16, width: 17, display: 'inline-grid', placeItems: 'center' }}>💸</span> Pedidos de adiantamento
              {advancesCount > 0 ? <span className="acct-item-badge">{advancesCount > 99 ? '99+' : advancesCount}</span> : null}
            </button>
          ) : null}
          <button className="acct-item" onClick={() => { setOpen(false); onSettings(); }}><IconGear size={17} /> Configurações</button>
          <button className="acct-item danger" onClick={() => { setOpen(false); onLogout(); }}><IconLogout size={17} /> Terminar sessão</button>
        </div>
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
    <div className="admin">
      {menuOpen ? <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} /> : null}
      <aside ref={asideRef} className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src={brandLogo} alt={brandName} onError={(e) => { (e.target as HTMLImageElement).src = LOGO_SRC; }} />
          <div>
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
                    onClick={() => setOpenGroups((p) => (p[n.key] ? {} : { [n.key]: true }))}
                  >
                    <Icon size={18} /> {n.label}
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
                onClick={() => setSection(n.key)}
              >
                <Icon size={18} /> {n.label}
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
          <h1>{current?.label}</h1>
          <span className="spacer" />
          {!isTenant ? <NotifyBell onGo={(s) => setSection(s)} /> : null}
          {isTenant ? <OrdersBell onGo={() => setSection('orders')} /> : null}
          <ThemePicker />
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
            onOpenCash={() => {
              const p = new URLSearchParams();
              p.set('staff', user?.email || '');
              if (user?.name) p.set('nome', user.name);
              if (companyCode) p.set('empresa', companyCode);
              window.open(`${CAIXA_URL}/?${p.toString()}`, '_blank', 'noopener');
            }}
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
    </div>
  );
}
