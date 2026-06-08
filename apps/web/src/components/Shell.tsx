import React, { useEffect, useRef, useState } from 'react';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { IconLogout } from './Icons';
import { ThemePicker } from './ThemePicker';

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
function ManagerMenu({ photo, name, email, role, onSettings, onLogout }: {
  photo: string | null; name: string; email: string; role: string; onSettings(): void; onLogout(): void;
}) {
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
          <button className="acct-item" onClick={() => { setOpen(false); onSettings(); }}><IconGear size={17} /> Configurações</button>
          <button className="acct-item danger" onClick={() => { setOpen(false); onLogout(); }}><IconLogout size={17} /> Terminar sessão</button>
        </div>
      ) : null}
    </div>
  );
}

/** Item de navegação genérico (serve os dois painéis: plataforma e gestor). */
export interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Sub-opções (menu agrupado). Se presente, o item abre/fecha um grupo. */
  children?: NavItem[];
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
          <ThemePicker />
          <ManagerMenu
            photo={avatar}
            name={user?.name || user?.email || 'Gestor'}
            email={user?.email || ''}
            role={`${roleLabel}${companyCode ? ` · ${companyCode}` : ''}`}
            onSettings={() => setSection('profile')}
            onLogout={logout}
          />
        </header>
        <div className="content"><div className="page-anim" key={section}>{children}</div></div>
      </div>
    </div>
  );
}
