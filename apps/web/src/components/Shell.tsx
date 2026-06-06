import React, { useEffect, useState } from 'react';
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
  useEffect(() => {
    const g = nav.find((n) => n.children?.some((c) => c.key === section));
    if (g) setOpenGroups((prev) => (prev[g.key] ? prev : { ...prev, [g.key]: true }));
  }, [section, nav]);

  return (
    <div className="admin">
      {menuOpen ? <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
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
                    onClick={() => setOpenGroups((p) => ({ ...p, [n.key]: !p[n.key] }))}
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
                            onClick={() => setSection(c.key)}
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
          <div className="who">
            <div className="nm">{user?.name || user?.email}</div>
            <div className="rl">
              {roleLabel}
              {companyCode ? ` · ${companyCode}` : ''}
            </div>
          </div>
          <ThemePicker />
          <button className="icon-btn" onClick={logout} title="Terminar sessão">
            <IconLogout size={20} />
          </button>
        </header>
        <div className="content"><div className="page-anim" key={section}>{children}</div></div>
      </div>
    </div>
  );
}
