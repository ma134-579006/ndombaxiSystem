import React from 'react';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { IconLogout } from './Icons';

/** Item de navegação genérico (serve os dois painéis: plataforma e gestor). */
export interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
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
  const current = nav.find((n) => n.key === section);

  return (
    <div className="admin">
      <aside className="sidebar">
        <div className="brand">
          <img src={LOGO_SRC} alt={SYSTEM_NAME} />
          <div>
            <div className="nm">{SYSTEM_NAME}</div>
            <div className="tg">{subtitle}</div>
          </div>
        </div>
        <nav className="nav">
          {nav.map((n) => {
            const Icon = n.icon;
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
          <h1>{current?.label}</h1>
          <span className="spacer" />
          <div className="who">
            <div className="nm">{user?.email}</div>
            <div className="rl">
              {roleLabel}
              {companyCode ? ` · ${companyCode}` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={logout} title="Terminar sessão">
            <IconLogout size={20} />
          </button>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
