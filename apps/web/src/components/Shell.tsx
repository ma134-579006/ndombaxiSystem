import React from 'react';
import { LOGO_SRC, SYSTEM_NAME, copyrightLine } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { IconBuilding, IconCard, IconCpu, IconLogout, IconReceipt } from './Icons';

export type Section = 'tenants' | 'ai' | 'fiscal' | 'gateways';

const NAV: { key: Section; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'tenants', label: 'Empresas', icon: IconBuilding },
  { key: 'ai', label: 'Inteligência Artificial', icon: IconCpu },
  { key: 'fiscal', label: 'Fiscal (AGT)', icon: IconReceipt },
  { key: 'gateways', label: 'Gateways de Pagamento', icon: IconCard },
];

export function Shell({
  section,
  setSection,
  children,
}: {
  section: Section;
  setSection(s: Section): void;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const current = NAV.find((n) => n.key === section);

  return (
    <div className="admin">
      <aside className="sidebar">
        <div className="brand">
          <img src={LOGO_SRC} alt={SYSTEM_NAME} />
          <div>
            <div className="nm">{SYSTEM_NAME}</div>
            <div className="tg">Administração</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
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
            <div className="rl">Super Admin</div>
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
