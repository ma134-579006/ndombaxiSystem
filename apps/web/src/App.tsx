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
import { SupportChat } from './components/SupportChat';
import { FeedbackHost } from './components/feedback';
import { Ai } from './sections/Ai';
import { SupportAdmin } from './sections/SupportAdmin';
import { FeedbackAdmin } from './sections/FeedbackAdmin';
import { Fiscal } from './sections/Fiscal';
import { Gateways } from './sections/Gateways';
import { Tenants } from './sections/Tenants';
import { Products } from './sections/Products';
import { Orders } from './sections/Orders';
import { ServiceHub } from './sections/ServiceHub';
import { Restaurant } from './sections/Restaurant';
import { ServiceOrders } from './sections/ServiceOrders';
import { Hotel } from './sections/Hotel';
import { Clinic } from './sections/Clinic';
import { Pharmacy } from './sections/Pharmacy';
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
import { Accounting } from './sections/Accounting';
import { Assistant } from './sections/Assistant';
import { Cameras } from './sections/Cameras';
import { Customers } from './sections/Customers';
import { Leave } from './sections/Leave';
import { Stores } from './sections/Stores';
import { Subscription } from './sections/Subscription';
import { Storefront } from './sections/Storefront';
import { PlansAdmin } from './sections/PlansAdmin';
import { SubsAdmin } from './sections/SubsAdmin';
import { PlatformDashboard } from './sections/PlatformDashboard';
import { Integrations } from './sections/Integrations';
import { MailSettings } from './sections/MailSettings';

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
  { key: 'mail', label: 'E-mail (SMTP)', icon: IconReceipt },
];

// min: nível mínimo de papel (0=mais poder). 1=COMPANY_ADMIN, 2=REGIONAL_MANAGER,
// 3=STORE_MANAGER, 4=SHIFT_SUPERVISOR. Omisso → 3 (visível a gerente de loja e acima).
// O supervisor (4) entra no painel mas só vê monitorização/aprovação (min:4); o
// CRUD do sistema continua reservado a gerente de loja e acima (backend e nav).
const TENANT_NAV: NavItem[] = [
  { key: 'overview', label: 'Visão geral', icon: IconChart, min: 4 },
  { key: 'assistant', label: 'Assistente IA', icon: IconCpu, min: 2 },
  { key: 'subscription', label: 'Subscrição & Plano', icon: IconCard, min: 1 },
  {
    key: 'stores-group', label: 'Lojas', icon: IconStore, children: [
      { key: 'stores', label: 'Criar lojas', icon: IconStore, min: 2 },
      { key: 'store', label: 'Loja & Marca', icon: IconStore, min: 1 },
      { key: 'orders', label: 'Encomendas', icon: IconTruck, min: 4 },
      { key: 'commissions', label: 'Comissões', icon: IconStar, min: 2 },
    ],
  },
  {
    key: 'products-group', label: 'Produtos', icon: IconCube, children: [
      { key: 'products', label: 'Criar produtos', icon: IconCube },
      { key: 'inventory', label: 'Inventário', icon: IconTruck },
      { key: 'stock-analysis', label: 'Análise de stock', icon: IconChart, min: 4 },
      { key: 'stock-movements', label: 'Movimentos de stock', icon: IconChart },
      { key: 'purchasing', label: 'Compras', icon: IconTruck, min: 2 },
      { key: 'promotions', label: 'Promoções', icon: IconStar },
    ],
  },
  {
    // Grupo sem `min` próprio (default 3) para o gerente de loja continuar a ver
    // Caixa & Auditoria e Relatórios; os itens financeiros mantêm min:2 (ocultos
    // ao gerente de loja, como antes).
    key: 'movements-group', label: 'Movimentações', icon: IconCard, children: [
      { key: 'payments', label: 'Pagamentos', icon: IconCard, min: 2 },
      { key: 'profit', label: 'Lucros', icon: IconChart, min: 2 },
      { key: 'expenses', label: 'Gastos', icon: IconReceipt, min: 2 },
      { key: 'cashflow', label: 'Fluxo de Caixa', icon: IconChart, min: 2 },
      { key: 'reconciliation', label: 'Conciliação', icon: IconCard, min: 2 },
      { key: 'payables', label: 'Contas a Pagar', icon: IconTruck, min: 2 },
      { key: 'receivables', label: 'Contas a Receber', icon: IconCard, min: 2 },
      { key: 'accounting', label: 'Contabilidade', icon: IconReceipt, min: 2 },
      { key: 'operations', label: 'Caixa & Auditoria', icon: IconChart, min: 4 },
      { key: 'reports', label: 'Relatórios', icon: IconChart },
    ],
  },
  {
    key: 'users-group', label: 'Usuários', icon: IconBuilding, children: [
      { key: 'employees', label: 'Funcionários', icon: IconBuilding },
      { key: 'payroll', label: 'Folha Salarial', icon: IconReceipt, min: 2 },
      { key: 'leave', label: 'Férias', icon: IconBuilding },
    ],
  },
  { key: 'customers', label: 'Clientes', icon: IconBuilding },
  {
    key: 'cameras-group', label: 'Câmaras', icon: IconCpu, children: [
      { key: 'cameras-config', label: 'Configurar', icon: IconCpu, min: 1 },
      { key: 'cameras-live', label: 'Abrir', icon: IconCpu },
    ],
  },
  { key: 'saft', label: 'Fiscal · SAF-T', icon: IconReceipt, min: 1 },
  { key: 'settings', label: 'Configurações', icon: IconBuilding, min: 1 },
];

/** Nível numérico de cada papel (espelha o backend; menor = mais poder). */
const ROLE_LEVEL: Record<string, number> = {
  SUPER_ADMIN: 0, COMPANY_ADMIN: 1, REGIONAL_MANAGER: 2, STORE_MANAGER: 3,
  SHIFT_SUPERVISOR: 4, CASHIER: 5, ATTENDANT: 6,
};

/** Filtra a navegação pelo papel: mostra só o que o nível permite (e grupos
 *  ficam visíveis se tiverem pelo menos um sub-item permitido). */
function navForRole(items: NavItem[], role: string | undefined): NavItem[] {
  const level = ROLE_LEVEL[role ?? ''] ?? 3;
  const ok = (it: NavItem) => level <= (it.min ?? 3);
  return items
    .filter(ok)
    .map((it) => (it.children ? { ...it, children: it.children.filter(ok) } : it))
    .filter((it) => !it.children || it.children.length > 0);
}

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
      {section === 'mail' ? <MailSettings /> : null}
      {section === 'profile' ? <Profile /> : null}
    </Shell>
  );
}

/** Rótulo do vertical de serviços (para o item de navegação adaptativo). */
const VERTICAL_LABEL: Record<string, string> = {
  RESTAURANT: '🍔 Restauração', SERVICES: '🔧 Serviços', HOSPITALITY: '🏨 Hotelaria', CLINIC: '🏥 Clínica', PHARMACY: '💊 Farmácia',
};

function TenantPanel() {
  const { user } = useAuth();
  const [section, setSection] = useWorkspace('overview');
  // Tipo de negócio (RETAIL por omissão) → adapta o painel ao serviço escolhido.
  const [bizType, setBizType] = useState('RETAIL');
  React.useEffect(() => {
    let alive = true;
    api.branding().then((b) => { if (alive) setBizType(b.businessType || 'RETAIL'); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const nav = React.useMemo(() => {
    const base = navForRole(TENANT_NAV, user?.role);
    if (bizType === 'RETAIL' || !VERTICAL_LABEL[bizType]) return base;
    // Mesmo painel base + itens próprios do vertical (logo a seguir à Visão geral).
    const vert: NavItem[] = [{ key: 'service-hub', label: VERTICAL_LABEL[bizType], icon: IconStore }];
    if (bizType === 'RESTAURANT') vert.push({ key: 'restaurant', label: '🍽️ Mesas & Comandas', icon: IconStore });
    if (bizType === 'SERVICES') vert.push({ key: 'service-orders', label: '🛠️ Ordens de serviço', icon: IconStore });
    if (bizType === 'HOSPITALITY') vert.push({ key: 'hotel', label: '🛏️ Quartos & Reservas', icon: IconStore });
    if (bizType === 'CLINIC') vert.push({ key: 'clinic', label: '🩺 Agenda & Pacientes', icon: IconStore });
    if (bizType === 'PHARMACY') vert.push({ key: 'pharmacy', label: '💊 Validade & Lotes', icon: IconStore });
    return [base[0], ...vert, ...base.slice(1)];
  }, [user?.role, bizType]);
  // se a secção guardada já não é permitida ao papel, volta à visão geral.
  // 'profile' não está na navegação (abre-se pelo menu da conta) → incluir aqui,
  // senão o guarda redirecionava o "Configurações do perfil" para a visão geral.
  const allowed = React.useMemo(() => {
    const s = new Set(nav.flatMap((n) => (n.children ? n.children.map((c) => c.key) : [n.key])));
    s.add('profile');
    return s;
  }, [nav]);
  const safeSection = allowed.has(section) ? section : 'overview';
  React.useEffect(() => { if (section !== safeSection) setSection(safeSection); }, [section, safeSection]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <Shell nav={nav} section={safeSection} setSection={setSection} roleLabel="Gestor" subtitle="Gestão da empresa">
      {section === 'overview' ? <Overview /> : null}
      {section === 'service-hub' ? <ServiceHub businessType={bizType} onGo={setSection} /> : null}
      {section === 'restaurant' ? <Restaurant /> : null}
      {section === 'service-orders' ? <ServiceOrders /> : null}
      {section === 'hotel' ? <Hotel /> : null}
      {section === 'clinic' ? <Clinic /> : null}
      {section === 'pharmacy' ? <Pharmacy /> : null}
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
      {section === 'customers' ? <Customers /> : null}
      {section === 'accounting' ? <Accounting /> : null}
      {section === 'cameras-config' ? <Cameras mode="config" /> : null}
      {section === 'cameras-live' ? <Cameras mode="live" /> : null}
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
      {/* O mesmo assistente IA da landing, disponível dentro do painel. */}
      <SupportChat />
    </Shell>
  );
}

function Gate() {
  const { status, mode, shadow, exitShadow } = useAuth();
  // O domínio principal (ndombaxisystem.com) abre SEMPRE a landing — o login
  // direto vive em admin.ndombaxisystem.com (e nos previews .pages.dev /
  // localhost, onde quem já entrou antes vai direto ao ecrã de login).
  const isAdminHost = /^admin\./i.test(window.location.hostname)
    || window.location.hostname.endsWith('.pages.dev')
    || window.location.hostname === 'localhost';
  const [view, setView] = useState<'landing' | 'login' | 'register'>(() => {
    if (!isAdminHost) return 'landing';
    try { return localStorage.getItem('ndombaxi.web.hadSession') ? 'login' : 'landing'; } catch { return 'landing'; }
  });
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
        {/* Toasts + diálogos de confirmação enterprise (todo o painel). */}
        <FeedbackHost />
      </KeyboardProvider>
    </AuthProvider>
  );
}
