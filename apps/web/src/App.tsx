import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { loadSection, restoreDrafts, saveSection, startDraftCapture } from './workspace';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { Shell, type NavItem } from './components/Shell';
import { IconBuilding, IconCard, IconChart, IconCpu, IconCube, IconReceipt, IconStar, IconStore, IconTruck } from './components/Icons';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { CompanySetup } from './pages/CompanySetup';
import { PendingApproval } from './pages/PendingApproval';
import { PlanExpired } from './pages/PlanExpired';
import { Register } from './pages/Register';
import { api } from './api/client';
import './landing.css';
import { Ai } from './sections/Ai';
import { SupportAdmin } from './sections/SupportAdmin';
import { FeedbackAdmin } from './sections/FeedbackAdmin';
import { Fiscal } from './sections/Fiscal';
import { Gateways } from './sections/Gateways';
import { Tenants } from './sections/Tenants';
import { Products } from './sections/Products';
import { Orders } from './sections/Orders';
import { Payments } from './sections/Payments';
import { Operations } from './sections/Operations';
import { Inventory } from './sections/Inventory';
import { StockMovements } from './sections/StockMovements';
import { StockAnalysis } from './sections/StockAnalysis';
import { Reports } from './sections/Reports';
import { Settings } from './sections/Settings';
import { Profile } from './sections/Profile';
import { Promotions } from './sections/Promotions';
import { Overview } from './sections/Overview';
import { Profit } from './sections/Profit';
import { Saft } from './sections/Saft';
import { Cashflow } from './sections/Cashflow';
import { Commissions } from './sections/Commissions';
import { Expenses } from './sections/Expenses';
import { Receivables } from './sections/Receivables';
import { Payables } from './sections/Payables';
import { Reconciliation } from './sections/Reconciliation';
import { Employees } from './sections/Employees';
import { Payroll } from './sections/Payroll';
import { Purchasing } from './sections/Purchasing';
import { Assistant } from './sections/Assistant';
import { Leave } from './sections/Leave';
import { Stores } from './sections/Stores';
import { Subscription } from './sections/Subscription';
import { Storefront } from './sections/Storefront';
import { PlansAdmin } from './sections/PlansAdmin';
import { SubsAdmin } from './sections/SubsAdmin';
import { PlatformDashboard } from './sections/PlatformDashboard';
import { Integrations } from './sections/Integrations';

const PLATFORM_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: IconChart },
  { key: 'tenants', label: 'Empresas', icon: IconBuilding },
  { key: 'subs', label: 'Subscrições & Pagamentos', icon: IconCard },
  { key: 'support', label: 'Suporte do site', icon: IconCpu },
  { key: 'feedback', label: 'Comentários do site', icon: IconStar },
  { key: 'plans', label: 'Planos & Página inicial', icon: IconStar },
  { key: 'ai', label: 'Inteligência Artificial', icon: IconCpu },
  { key: 'fiscal', label: 'Fiscal (AGT)', icon: IconReceipt },
  { key: 'gateways', label: 'Gateways de Pagamento', icon: IconCard },
  { key: 'integrations', label: 'Integrações', icon: IconCpu },
];

const TENANT_NAV: NavItem[] = [
  { key: 'overview', label: 'Visão geral', icon: IconChart },
  { key: 'assistant', label: 'Assistente IA', icon: IconCpu },
  { key: 'subscription', label: 'Subscrição & Plano', icon: IconCard },
  {
    key: 'stores-group', label: 'Lojas', icon: IconStore, children: [
      { key: 'stores', label: 'Criar lojas', icon: IconStore },
      { key: 'store', label: 'Loja & Marca', icon: IconStore },
      { key: 'orders', label: 'Encomendas', icon: IconTruck },
      { key: 'commissions', label: 'Comissões', icon: IconStar },
    ],
  },
  {
    key: 'products-group', label: 'Produtos', icon: IconCube, children: [
      { key: 'products', label: 'Criar produtos', icon: IconCube },
      { key: 'inventory', label: 'Entrada stock/Inventário', icon: IconTruck },
      { key: 'stock-analysis', label: 'Análise de stock', icon: IconChart },
      { key: 'stock-movements', label: 'Movimentos de stock', icon: IconChart },
      { key: 'purchasing', label: 'Compras', icon: IconTruck },
      { key: 'promotions', label: 'Promoções', icon: IconStar },
    ],
  },
  {
    key: 'movements-group', label: 'Movimentações', icon: IconCard, children: [
      { key: 'payments', label: 'Pagamentos', icon: IconCard },
      { key: 'profit', label: 'Lucros', icon: IconChart },
      { key: 'expenses', label: 'Gastos', icon: IconReceipt },
      { key: 'cashflow', label: 'Fluxo de Caixa', icon: IconChart },
      { key: 'reconciliation', label: 'Conciliação', icon: IconCard },
      { key: 'payables', label: 'Contas a Pagar', icon: IconTruck },
      { key: 'receivables', label: 'Contas a Receber', icon: IconCard },
    ],
  },
  {
    key: 'users-group', label: 'Usuários', icon: IconBuilding, children: [
      { key: 'employees', label: 'Funcionários', icon: IconBuilding },
      { key: 'payroll', label: 'Folha Salarial', icon: IconReceipt },
      { key: 'leave', label: 'Férias', icon: IconBuilding },
    ],
  },
  { key: 'operations', label: 'Caixa & Auditoria', icon: IconChart },
  { key: 'reports', label: 'Relatórios', icon: IconChart },
  { key: 'saft', label: 'Fiscal · SAF-T', icon: IconReceipt },
  { key: 'settings', label: 'Configurações', icon: IconBuilding },
];

/** Página + rascunhos por utilizador: restaura onde o utilizador estava
 *  (mesmo após logout por inatividade) e o que estava a escrever. */
function useWorkspace(defaultSection: string): [string, (s: string) => void] {
  const { user } = useAuth();
  const uid = user?.sub ?? 'anon';
  const [section, setSectionState] = useState(() => loadSection(uid) ?? defaultSection);
  const setSection = (s: string) => { setSectionState(s); saveSection(uid, s); };
  useEffect(() => startDraftCapture(uid, () => section), [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = window.setTimeout(() => restoreDrafts(uid, section), 350); // após o render/fetchs
    return () => window.clearTimeout(t);
  }, [uid, section]);
  return [section, setSection];
}

function PlatformPanel() {
  const [section, setSection] = useWorkspace('dashboard');
  return (
    <Shell nav={PLATFORM_NAV} section={section} setSection={setSection} roleLabel="Super Admin" subtitle="Administração">
      {section === 'dashboard' ? <PlatformDashboard /> : null}
      {section === 'tenants' ? <Tenants /> : null}
      {section === 'subs' ? <SubsAdmin /> : null}
      {section === 'support' ? <SupportAdmin /> : null}
      {section === 'feedback' ? <FeedbackAdmin /> : null}
      {section === 'plans' ? <PlansAdmin /> : null}
      {section === 'ai' ? <Ai /> : null}
      {section === 'fiscal' ? <Fiscal /> : null}
      {section === 'gateways' ? <Gateways /> : null}
      {section === 'integrations' ? <Integrations /> : null}
    </Shell>
  );
}

function TenantPanel() {
  const [section, setSection] = useWorkspace('overview');
  // Gate: setup obrigatório → aprovação do Super Admin → plano válido → painel.
  const [gate, setGate] = useState<{ setupCompleted: boolean; approved: boolean; expired: boolean } | null>(null);
  React.useEffect(() => {
    let alive = true;
    api.onboarding.setupStatus()
      .then((s) => { if (alive) setGate({ setupCompleted: s.setupCompleted, approved: s.approved, expired: s.expired }); })
      .catch(() => { if (alive) setGate({ setupCompleted: true, approved: true, expired: false }); }); // em erro não bloqueia
    return () => { alive = false; };
  }, []);
  if (gate === null) {
    return <div className="login"><span className="muted">A carregar…</span></div>;
  }
  if (!gate.setupCompleted) {
    return <CompanySetup onDone={() => setGate({ setupCompleted: true, approved: false, expired: false })} />;
  }
  if (!gate.approved) {
    return <PendingApproval onApproved={() => window.location.reload()} />;
  }
  if (gate.expired) {
    return <PlanExpired onResolved={() => window.location.reload()} />;
  }
  return (
    <Shell nav={TENANT_NAV} section={section} setSection={setSection} roleLabel="Gestor" subtitle="Gestão da empresa">
      {section === 'overview' ? <Overview /> : null}
      {section === 'assistant' ? <Assistant /> : null}
      {section === 'subscription' ? <Subscription /> : null}
      {section === 'stores' ? <Stores /> : null}
      {section === 'products' ? <Products /> : null}
      {section === 'inventory' ? <Inventory /> : null}
      {section === 'stock-movements' ? <StockMovements /> : null}
      {section === 'stock-analysis' ? <StockAnalysis /> : null}
      {section === 'purchasing' ? <Purchasing /> : null}
      {section === 'orders' ? <Orders /> : null}
      {section === 'promotions' ? <Promotions /> : null}
      {section === 'payments' ? <Payments /> : null}
      {section === 'operations' ? <Operations /> : null}
      {section === 'reports' ? <Reports /> : null}
      {section === 'saft' ? <Saft /> : null}
      {section === 'profit' ? <Profit /> : null}
      {section === 'cashflow' ? <Cashflow /> : null}
      {section === 'commissions' ? <Commissions /> : null}
      {section === 'expenses' ? <Expenses /> : null}
      {section === 'receivables' ? <Receivables /> : null}
      {section === 'payables' ? <Payables /> : null}
      {section === 'reconciliation' ? <Reconciliation /> : null}
      {section === 'employees' ? <Employees /> : null}
      {section === 'payroll' ? <Payroll /> : null}
      {section === 'leave' ? <Leave /> : null}
      {section === 'store' ? <Storefront /> : null}
      {section === 'settings' ? <Settings /> : null}
      {section === 'profile' ? <Profile /> : null}
    </Shell>
  );
}

function Gate() {
  const { status, mode, shadow, exitShadow } = useAuth();
  // Visitantes novos: landing. Quem JÁ entrou antes neste browser (ou acabou de
  // fazer logout) vai direto ao ECRÃ DE LOGIN — nunca volta a cair na landing.
  const [view, setView] = useState<'landing' | 'login' | 'register'>(
    () => { try { return localStorage.getItem('ndombaxi.web.hadSession') ? 'login' : 'landing'; } catch { return 'landing'; } },
  );
  useEffect(() => {
    if (status === 'authed') {
      try { localStorage.setItem('ndombaxi.web.hadSession', '1'); } catch { /* ignora */ }
      setView('login'); // quando a sessão cair, aterra no login
    }
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="login">
        <span className="muted">A carregar…</span>
      </div>
    );
  }
  if (status !== 'authed') {
    if (view === 'login') return <Login onBack={() => setView('landing')} onRegister={() => setView('register')} />;
    if (view === 'register') return <Register onBack={() => setView('login')} />;
    return <Landing onGoLogin={() => setView('login')} onGoRegister={() => setView('register')} />;
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
