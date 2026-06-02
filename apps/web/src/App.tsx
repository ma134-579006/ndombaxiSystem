import React, { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { Shell, type NavItem } from './components/Shell';
import { IconBuilding, IconCard, IconChart, IconCpu, IconCube, IconReceipt, IconStar, IconStore, IconTruck } from './components/Icons';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import './landing.css';
import { Ai } from './sections/Ai';
import { Fiscal } from './sections/Fiscal';
import { Gateways } from './sections/Gateways';
import { Tenants } from './sections/Tenants';
import { Products } from './sections/Products';
import { Orders } from './sections/Orders';
import { Payments } from './sections/Payments';
import { Operations } from './sections/Operations';
import { Inventory } from './sections/Inventory';
import { Promotions } from './sections/Promotions';
import { Overview } from './sections/Overview';
import { Profit } from './sections/Profit';
import { Cashflow } from './sections/Cashflow';
import { Commissions } from './sections/Commissions';
import { Expenses } from './sections/Expenses';
import { Receivables } from './sections/Receivables';
import { Payables } from './sections/Payables';
import { Reconciliation } from './sections/Reconciliation';
import { Storefront } from './sections/Storefront';
import { PlansAdmin } from './sections/PlansAdmin';
import { SubsAdmin } from './sections/SubsAdmin';
import { PlatformDashboard } from './sections/PlatformDashboard';
import { Integrations } from './sections/Integrations';

const PLATFORM_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: IconChart },
  { key: 'tenants', label: 'Empresas', icon: IconBuilding },
  { key: 'subs', label: 'Subscrições & Pagamentos', icon: IconCard },
  { key: 'plans', label: 'Planos & Página inicial', icon: IconStar },
  { key: 'ai', label: 'Inteligência Artificial', icon: IconCpu },
  { key: 'fiscal', label: 'Fiscal (AGT)', icon: IconReceipt },
  { key: 'gateways', label: 'Gateways de Pagamento', icon: IconCard },
  { key: 'integrations', label: 'Integrações', icon: IconCpu },
];

const TENANT_NAV: NavItem[] = [
  { key: 'overview', label: 'Visão geral', icon: IconChart },
  { key: 'products', label: 'Produtos', icon: IconCube },
  { key: 'inventory', label: 'Inventário', icon: IconCube },
  { key: 'orders', label: 'Encomendas', icon: IconTruck },
  { key: 'promotions', label: 'Promoções', icon: IconStar },
  { key: 'payments', label: 'Pagamentos', icon: IconCard },
  { key: 'operations', label: 'Caixa & Auditoria', icon: IconChart },
  { key: 'profit', label: 'Lucros', icon: IconChart },
  { key: 'cashflow', label: 'Fluxo de Caixa', icon: IconChart },
  { key: 'commissions', label: 'Comissões', icon: IconStar },
  { key: 'expenses', label: 'Gastos', icon: IconReceipt },
  { key: 'receivables', label: 'Contas a Receber', icon: IconCard },
  { key: 'payables', label: 'Contas a Pagar', icon: IconTruck },
  { key: 'reconciliation', label: 'Conciliação', icon: IconCard },
  { key: 'store', label: 'Loja & Marca', icon: IconStore },
];

function PlatformPanel() {
  const [section, setSection] = useState('dashboard');
  return (
    <Shell nav={PLATFORM_NAV} section={section} setSection={setSection} roleLabel="Super Admin" subtitle="Administração">
      {section === 'dashboard' ? <PlatformDashboard /> : null}
      {section === 'tenants' ? <Tenants /> : null}
      {section === 'subs' ? <SubsAdmin /> : null}
      {section === 'plans' ? <PlansAdmin /> : null}
      {section === 'ai' ? <Ai /> : null}
      {section === 'fiscal' ? <Fiscal /> : null}
      {section === 'gateways' ? <Gateways /> : null}
      {section === 'integrations' ? <Integrations /> : null}
    </Shell>
  );
}

function TenantPanel() {
  const [section, setSection] = useState('overview');
  return (
    <Shell nav={TENANT_NAV} section={section} setSection={setSection} roleLabel="Gestor" subtitle="Gestão da empresa">
      {section === 'overview' ? <Overview /> : null}
      {section === 'products' ? <Products /> : null}
      {section === 'inventory' ? <Inventory /> : null}
      {section === 'orders' ? <Orders /> : null}
      {section === 'promotions' ? <Promotions /> : null}
      {section === 'payments' ? <Payments /> : null}
      {section === 'operations' ? <Operations /> : null}
      {section === 'profit' ? <Profit /> : null}
      {section === 'cashflow' ? <Cashflow /> : null}
      {section === 'commissions' ? <Commissions /> : null}
      {section === 'expenses' ? <Expenses /> : null}
      {section === 'receivables' ? <Receivables /> : null}
      {section === 'payables' ? <Payables /> : null}
      {section === 'reconciliation' ? <Reconciliation /> : null}
      {section === 'store' ? <Storefront /> : null}
    </Shell>
  );
}

function Gate() {
  const { status, mode, shadow, exitShadow } = useAuth();
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
  return (
    <>
      {shadow ? (
        <div className="shadow-bar">
          <span>👁 Modo shadow — a ver o painel de <strong>{shadow}</strong></span>
          <button className="btn sm" onClick={exitShadow}>Sair do shadow</button>
        </div>
      ) : null}
      {mode === 'platform' ? <PlatformPanel /> : <TenantPanel />}
    </>
  );
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
