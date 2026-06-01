import React, { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { Shell, type NavItem } from './components/Shell';
import { IconBuilding, IconCard, IconCpu, IconCube, IconReceipt, IconStore, IconTruck } from './components/Icons';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import './landing.css';
import { Ai } from './sections/Ai';
import { Fiscal } from './sections/Fiscal';
import { Gateways } from './sections/Gateways';
import { Tenants } from './sections/Tenants';
import { Products } from './sections/Products';
import { Orders } from './sections/Orders';
import { Storefront } from './sections/Storefront';

const PLATFORM_NAV: NavItem[] = [
  { key: 'tenants', label: 'Empresas', icon: IconBuilding },
  { key: 'ai', label: 'Inteligência Artificial', icon: IconCpu },
  { key: 'fiscal', label: 'Fiscal (AGT)', icon: IconReceipt },
  { key: 'gateways', label: 'Gateways de Pagamento', icon: IconCard },
];

const TENANT_NAV: NavItem[] = [
  { key: 'products', label: 'Produtos', icon: IconCube },
  { key: 'orders', label: 'Encomendas', icon: IconTruck },
  { key: 'store', label: 'Loja & Marca', icon: IconStore },
];

function PlatformPanel() {
  const [section, setSection] = useState('tenants');
  return (
    <Shell nav={PLATFORM_NAV} section={section} setSection={setSection} roleLabel="Super Admin" subtitle="Administração">
      {section === 'tenants' ? <Tenants /> : null}
      {section === 'ai' ? <Ai /> : null}
      {section === 'fiscal' ? <Fiscal /> : null}
      {section === 'gateways' ? <Gateways /> : null}
    </Shell>
  );
}

function TenantPanel() {
  const [section, setSection] = useState('products');
  return (
    <Shell nav={TENANT_NAV} section={section} setSection={setSection} roleLabel="Gestor" subtitle="Gestão da empresa">
      {section === 'products' ? <Products /> : null}
      {section === 'orders' ? <Orders /> : null}
      {section === 'store' ? <Storefront /> : null}
    </Shell>
  );
}

function Gate() {
  const { status, mode } = useAuth();
  // Visitantes começam na landing; "Entrar" leva ao login.
  const [showLogin, setShowLogin] = useState(false);

  if (status === 'loading') {
    return (
      <div className="login">
        <span className="muted">A carregar…</span>
      </div>
    );
  }
  if (status !== 'authed') {
    return showLogin ? <Login onBack={() => setShowLogin(false)} /> : <Landing onGoLogin={() => setShowLogin(true)} />;
  }
  return mode === 'platform' ? <PlatformPanel /> : <TenantPanel />;
}

export function App() {
  return (
    <AuthProvider>
      <KeyboardProvider>
        <Gate />
      </KeyboardProvider>
    </AuthProvider>
  );
}
