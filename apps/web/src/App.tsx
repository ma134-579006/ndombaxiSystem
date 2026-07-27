import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { loadSection, restoreDrafts, saveSection, startDraftCapture } from './workspace';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { Shell, type NavItem } from './components/Shell';
import {
  IconArrowLeftRight, IconBadge, IconBank, IconBoxes, IconBuilding, IconCalendar,
  IconCamera, IconCard, IconCartIn, IconCashRegister, IconChart, IconCoins, IconCube,
  IconDatabase, IconDownload, IconGauge, IconGear, IconHeadset, IconHistory, IconLedger, IconMail,
  IconMessage, IconPercent, IconPlug, IconReceipt, IconReport, IconSparkles,
  IconStore, IconTag, IconTrendUp, IconTruck, IconUpload, IconUsers, IconWallet,
} from './components/Icons';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { DownloadsPage } from './pages/DownloadsPage';
import { CompanySetup } from './pages/CompanySetup';
import { PendingApproval } from './pages/PendingApproval';
import { PlanExpired } from './pages/PlanExpired';
import { Register } from './pages/Register';
import { api } from './api/client';
import './landing.css';
import { SupportChat } from './components/SupportChat';
import { FeedbackHost } from './components/feedback';
import { FirstSteps } from './components/FirstSteps';

/* CODE-SPLIT (Fase 3 da auditoria): cada secção só descarrega quando é
 * aberta — o bundle inicial fica leve para Android de entrada. React.lazy +
 * Suspense nos painéis; páginas de arranque (Landing/Login/Registo) ficam eager. */
const Ai = React.lazy(() => import('./sections/Ai').then((m) => ({ default: m.Ai })));
const SupportAdmin = React.lazy(() => import('./sections/SupportAdmin').then((m) => ({ default: m.SupportAdmin })));
const FeedbackAdmin = React.lazy(() => import('./sections/FeedbackAdmin').then((m) => ({ default: m.FeedbackAdmin })));
const Fiscal = React.lazy(() => import('./sections/Fiscal').then((m) => ({ default: m.Fiscal })));
const Gateways = React.lazy(() => import('./sections/Gateways').then((m) => ({ default: m.Gateways })));
const Tenants = React.lazy(() => import('./sections/Tenants').then((m) => ({ default: m.Tenants })));
const Products = React.lazy(() => import('./sections/Products').then((m) => ({ default: m.Products })));
const Orders = React.lazy(() => import('./sections/Orders').then((m) => ({ default: m.Orders })));
const ServiceHub = React.lazy(() => import('./sections/ServiceHub').then((m) => ({ default: m.ServiceHub })));
const ServicesHome = React.lazy(() => import('./sections/ServicesHome').then((m) => ({ default: m.ServicesHome })));
const RestaurantHome = React.lazy(() => import('./sections/RestaurantHome').then((m) => ({ default: m.RestaurantHome })));
const HotelHome = React.lazy(() => import('./sections/HotelHome').then((m) => ({ default: m.HotelHome })));
const ClinicHome = React.lazy(() => import('./sections/ClinicHome').then((m) => ({ default: m.ClinicHome })));
const RestaurantKitchen = React.lazy(() => import('./sections/RestaurantKitchen').then((m) => ({ default: m.RestaurantKitchen })));
const Restaurant = React.lazy(() => import('./sections/Restaurant').then((m) => ({ default: m.Restaurant })));
const ServiceOrders = React.lazy(() => import('./sections/ServiceOrders').then((m) => ({ default: m.ServiceOrders })));
const Hotel = React.lazy(() => import('./sections/Hotel').then((m) => ({ default: m.Hotel })));
const Clinic = React.lazy(() => import('./sections/Clinic').then((m) => ({ default: m.Clinic })));
const Pharmacy = React.lazy(() => import('./sections/Pharmacy').then((m) => ({ default: m.Pharmacy })));
const Payments = React.lazy(() => import('./sections/Payments').then((m) => ({ default: m.Payments })));
const Operations = React.lazy(() => import('./sections/Operations').then((m) => ({ default: m.Operations })));
const Inventory = React.lazy(() => import('./sections/Inventory').then((m) => ({ default: m.Inventory })));
const StockMovements = React.lazy(() => import('./sections/StockMovements').then((m) => ({ default: m.StockMovements })));
const StockAnalysis = React.lazy(() => import('./sections/StockAnalysis').then((m) => ({ default: m.StockAnalysis })));
const InventoryIntel = React.lazy(() => import('./sections/InventoryIntel').then((m) => ({ default: m.InventoryIntel })));
const Reports = React.lazy(() => import('./sections/Reports').then((m) => ({ default: m.Reports })));
const Settings = React.lazy(() => import('./sections/Settings').then((m) => ({ default: m.Settings })));
const Profile = React.lazy(() => import('./sections/Profile').then((m) => ({ default: m.Profile })));
const Promotions = React.lazy(() => import('./sections/Promotions').then((m) => ({ default: m.Promotions })));
const Overview = React.lazy(() => import('./sections/Overview').then((m) => ({ default: m.Overview })));
const Profit = React.lazy(() => import('./sections/Profit').then((m) => ({ default: m.Profit })));
const Saft = React.lazy(() => import('./sections/Saft').then((m) => ({ default: m.Saft })));
const Cashflow = React.lazy(() => import('./sections/Cashflow').then((m) => ({ default: m.Cashflow })));
const Commissions = React.lazy(() => import('./sections/Commissions').then((m) => ({ default: m.Commissions })));
const Expenses = React.lazy(() => import('./sections/Expenses').then((m) => ({ default: m.Expenses })));
const Receivables = React.lazy(() => import('./sections/Receivables').then((m) => ({ default: m.Receivables })));
const Payables = React.lazy(() => import('./sections/Payables').then((m) => ({ default: m.Payables })));
const Reconciliation = React.lazy(() => import('./sections/Reconciliation').then((m) => ({ default: m.Reconciliation })));
const Employees = React.lazy(() => import('./sections/Employees').then((m) => ({ default: m.Employees })));
const Payroll = React.lazy(() => import('./sections/Payroll').then((m) => ({ default: m.Payroll })));
const Purchasing = React.lazy(() => import('./sections/Purchasing').then((m) => ({ default: m.Purchasing })));
const Accounting = React.lazy(() => import('./sections/Accounting').then((m) => ({ default: m.Accounting })));
const Assistant = React.lazy(() => import('./sections/Assistant').then((m) => ({ default: m.Assistant })));
const Cameras = React.lazy(() => import('./sections/Cameras').then((m) => ({ default: m.Cameras })));
const Customers = React.lazy(() => import('./sections/Customers').then((m) => ({ default: m.Customers })));
const Leave = React.lazy(() => import('./sections/Leave').then((m) => ({ default: m.Leave })));
const Stores = React.lazy(() => import('./sections/Stores').then((m) => ({ default: m.Stores })));
const Subscription = React.lazy(() => import('./sections/Subscription').then((m) => ({ default: m.Subscription })));
const Storefront = React.lazy(() => import('./sections/Storefront').then((m) => ({ default: m.Storefront })));
const PlansAdmin = React.lazy(() => import('./sections/PlansAdmin').then((m) => ({ default: m.PlansAdmin })));
const SubsAdmin = React.lazy(() => import('./sections/SubsAdmin').then((m) => ({ default: m.SubsAdmin })));
const PlatformDashboard = React.lazy(() => import('./sections/PlatformDashboard').then((m) => ({ default: m.PlatformDashboard })));
const Integrations = React.lazy(() => import('./sections/Integrations').then((m) => ({ default: m.Integrations })));
const MailSettings = React.lazy(() => import('./sections/MailSettings').then((m) => ({ default: m.MailSettings })));
const Downloads = React.lazy(() => import('./sections/Downloads').then((m) => ({ default: m.Downloads })));
const DownloadWizard = React.lazy(() => import('./sections/DownloadWizard').then((m) => ({ default: m.DownloadWizard })));
const Backup = React.lazy(() => import('./sections/Backup').then((m) => ({ default: m.Backup })));
const BackupRestore = React.lazy(() => import('./sections/BackupRestore').then((m) => ({ default: m.BackupRestore })));
const Migration = React.lazy(() => import('./sections/Migration').then((m) => ({ default: m.Migration })));

/* Ícones SEMÂNTICOS: cada módulo usa o ícone que representa exatamente a
   função (dashboard=velocímetro, empresas=edifício, suporte=auscultadores,
   IA=faíscas, integrações=ficha, e-mail=envelope…). Uma só biblioteca. */
const PLATFORM_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: IconGauge },
  { key: 'tenants', label: 'Empresas', icon: IconBuilding },
  { key: 'subs', label: 'Subscrições & Pagamentos', icon: IconCard },
  { key: 'support', label: 'Suporte do site', icon: IconHeadset },
  { key: 'feedback', label: 'Comentários do site', icon: IconMessage },
  { key: 'plans', label: 'Planos & Página inicial', icon: IconTag },
  { key: 'ai', label: 'Inteligência Artificial', icon: IconSparkles },
  { key: 'fiscal', label: 'Fiscal (AGT)', icon: IconReceipt },
  { key: 'gateways', label: 'Gateways de Pagamento', icon: IconBank },
  { key: 'integrations', label: 'Integrações', icon: IconPlug },
  { key: 'mail', label: 'E-mail (SMTP)', icon: IconMail },
  { key: 'downloads', label: 'Gestão de Downloads', icon: IconDownload },
];

// min: nível mínimo de papel (0=mais poder). 1=COMPANY_ADMIN, 2=REGIONAL_MANAGER,
// 3=STORE_MANAGER, 4=SHIFT_SUPERVISOR. Omisso → 3 (visível a gerente de loja e acima).
// O supervisor (4) entra no painel mas só vê monitorização/aprovação (min:4); o
// CRUD do sistema continua reservado a gerente de loja e acima (backend e nav).
const TENANT_NAV: NavItem[] = [
  { key: 'overview', label: 'Visão geral', icon: IconGauge, min: 4 },
  { key: 'assistant', label: 'Assistente IA', icon: IconSparkles, min: 2 },
  { key: 'subscription', label: 'Subscrição & Plano', icon: IconCard, min: 1 },
  {
    key: 'stores-group', label: 'Lojas', icon: IconStore, children: [
      { key: 'stores', label: 'Criar lojas', icon: IconStore, min: 2 },
      { key: 'store', label: 'Loja & Marca', icon: IconTag, min: 1 },
      { key: 'orders', label: 'Encomendas', icon: IconTruck, min: 4 },
      { key: 'commissions', label: 'Comissões', icon: IconPercent, min: 2 },
    ],
  },
  {
    key: 'products-group', label: 'Produtos', icon: IconCube, children: [
      { key: 'products', label: 'Criar produtos', icon: IconCube },
      // Inventário ÚNICO (o antigo 'Inventário' + 'Inventário PRO' + 'Análise de
      // stock' são agora ABAS dentro desta secção — ver InventoryIntel).
      { key: 'inventory', label: 'Inventário', icon: IconBoxes },
      { key: 'stock-movements', label: 'Movimentos de stock', icon: IconHistory },
      { key: 'purchasing', label: 'Compras', icon: IconCartIn, min: 2 },
      { key: 'promotions', label: 'Promoções', icon: IconTag },
    ],
  },
  {
    // Grupo sem `min` próprio (default 3) para o gerente de loja continuar a ver
    // Caixa & Auditoria e Relatórios; os itens financeiros mantêm min:2 (ocultos
    // ao gerente de loja, como antes).
    key: 'movements-group', label: 'Movimentações', icon: IconCoins, children: [
      { key: 'payments', label: 'Pagamentos', icon: IconCard, min: 2 },
      { key: 'profit', label: 'Lucros', icon: IconTrendUp, min: 2 },
      { key: 'expenses', label: 'Gastos', icon: IconReceipt, min: 2 },
      { key: 'cashflow', label: 'Fluxo de Caixa', icon: IconCoins, min: 2 },
      { key: 'reconciliation', label: 'Conciliação', icon: IconArrowLeftRight, min: 2 },
      { key: 'payables', label: 'Contas a Pagar', icon: IconWallet, min: 2 },
      { key: 'receivables', label: 'Contas a Receber', icon: IconCoins, min: 2 },
      { key: 'accounting', label: 'Contabilidade', icon: IconLedger, min: 2 },
      { key: 'operations', label: 'Caixa & Auditoria', icon: IconCashRegister, min: 4 },
      { key: 'reports', label: 'Relatórios', icon: IconReport },
    ],
  },
  {
    key: 'users-group', label: 'Equipa', icon: IconBadge, children: [
      { key: 'employees', label: 'Funcionários', icon: IconBadge },
      { key: 'payroll', label: 'Folha Salarial', icon: IconWallet, min: 2 },
      { key: 'leave', label: 'Férias', icon: IconCalendar },
    ],
  },
  { key: 'customers', label: 'Clientes', icon: IconUsers },
  {
    key: 'cameras-group', label: 'Câmaras', icon: IconCamera, children: [
      { key: 'cameras-config', label: 'Configurar', icon: IconGear, min: 1 },
      { key: 'cameras-live', label: 'Abrir', icon: IconCamera },
    ],
  },
  { key: 'saft', label: 'Fiscal · SAF-T', icon: IconReceipt, min: 1 },
  {
    key: 'backup-group', label: 'Backup & Restauro', icon: IconDatabase, min: 1, children: [
      { key: 'backup', label: 'Backup', icon: IconDatabase, min: 1 },
      { key: 'backup-restore', label: 'Restauro backup', icon: IconHistory, min: 1 },
      { key: 'migration', label: 'Migração', icon: IconUpload, min: 1 },
    ],
  },
  { key: 'settings', label: 'Configurações', icon: IconGear, min: 1 },
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
      <React.Suspense fallback={<div className="card" style={{ padding: 28, textAlign: 'center' }}><span className="muted">A carregar…</span></div>}>
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
      {section === 'downloads' ? <Downloads onOpenWizard={() => setSection('downloads-wizard')} /> : null}
      {section === 'downloads-wizard' ? <DownloadWizard onDone={() => setSection('downloads')} onCancel={() => setSection('downloads')} /> : null}
      {section === 'profile' ? <Profile /> : null}
    </React.Suspense>
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
  // Módulo Loja Online: quando desligado, esconde os menus da loja/encomendas.
  const [storeEnabled, setStoreEnabled] = useState(true);
  React.useEffect(() => {
    let alive = true;
    api.branding().then((b) => { if (alive) { setBizType(b.businessType || 'RETAIL'); setStoreEnabled(b.onlineStoreEnabled !== false); } }).catch(() => undefined);
    return () => { alive = false; };
  }, [section]); // recarrega ao voltar de Configurações (reflete o toggle na hora)
  const nav = React.useMemo(() => {
    // Loja Online desligada → remove "Loja & Marca" (montra) e "Encomendas".
    const ONLINE_KEYS = new Set(['store', 'orders']);
    const gateStore = (items: NavItem[]): NavItem[] => storeEnabled ? items : items
      .map((it) => it.children ? { ...it, children: it.children.filter((c) => !ONLINE_KEYS.has(c.key)) } : it)
      .filter((it) => !ONLINE_KEYS.has(it.key) && !(it.children && it.children.length === 0));
    const base = gateStore(navForRole(TENANT_NAV, user?.role));
    if (bizType === 'RETAIL' || !VERTICAL_LABEL[bizType]) return base;

    // RESTAURANT: navegação PRÓPRIA do setor — a operação de restaurante LIDERA e
    // o retalho/financeiro passa a backoffice REENQUADRADO (mesmas secções e
    // permissões: derivamos da `base` já filtrada por papel, só reordenamos e
    // renomeamos). Deixa de "parecer vendas": um restaurante entra num sistema de
    // restaurante, não num supermercado com a cozinha colada ao lado.
    if (bizType === 'RESTAURANT') {
      const byKey = new Map(base.map((g) => [g.key, g] as const));
      const relabel = (key: string, label: string): NavItem[] => {
        const g = byKey.get(key); return g ? [{ ...g, label }] : [];
      };
      const spine: NavItem[] = [
        base[0], // Visão geral
        { key: 'service-hub', label: 'Centro de comando', icon: IconGauge },
        { key: 'restaurant', label: 'Sala & Comandas', icon: IconStore },
        { key: 'restaurant-kds', label: 'Cozinha', icon: IconStore },
      ];
      const reframed = new Set(['overview', 'products-group', 'movements-group']);
      const rest = base.slice(1).filter((g) => !reframed.has(g.key));
      return [
        ...spine,
        ...relabel('products-group', 'Cardápio & Stock'),
        ...relabel('movements-group', 'Caixa & Financeiro'),
        ...rest,
      ];
    }

    // HOSPITALITY: mesma engenharia — o PMS LIDERA (Centro de comando + Quartos
    // & Reservas), o retalho/financeiro vira backoffice reenquadrado.
    if (bizType === 'HOSPITALITY') {
      const byKey = new Map(base.map((g) => [g.key, g] as const));
      const relabel = (key: string, label: string): NavItem[] => {
        const g = byKey.get(key); return g ? [{ ...g, label }] : [];
      };
      const spine: NavItem[] = [
        base[0], // Visão geral
        { key: 'service-hub', label: 'Centro de comando', icon: IconGauge },
        { key: 'hotel', label: 'Quartos & Reservas', icon: IconStore },
      ];
      const reframed = new Set(['overview', 'products-group', 'movements-group']);
      const rest = base.slice(1).filter((g) => !reframed.has(g.key));
      return [
        ...spine,
        ...relabel('products-group', 'Serviços & Stock'),
        ...relabel('movements-group', 'Caixa & Financeiro'),
        ...rest,
      ];
    }

    // CLINIC: mesma engenharia — a clínica LIDERA (Centro de comando + Agenda &
    // Pacientes); o retalho/financeiro vira backoffice reenquadrado.
    if (bizType === 'CLINIC') {
      const byKey = new Map(base.map((g) => [g.key, g] as const));
      const relabel = (key: string, label: string): NavItem[] => {
        const g = byKey.get(key); return g ? [{ ...g, label }] : [];
      };
      const spine: NavItem[] = [
        base[0], // Visão geral
        { key: 'service-hub', label: 'Centro de comando', icon: IconGauge },
        { key: 'clinic', label: 'Agenda & Pacientes', icon: IconStore },
      ];
      const reframed = new Set(['overview', 'products-group', 'movements-group']);
      const rest = base.slice(1).filter((g) => !reframed.has(g.key));
      return [
        ...spine,
        ...relabel('products-group', 'Farmácia & Stock'),
        ...relabel('movements-group', 'Caixa & Financeiro'),
        ...rest,
      ];
    }

    // SERVICES: mesma engenharia — a OFICINA lidera (Centro de comando + Ordens
    // de serviço); o retalho/financeiro vira backoffice reenquadrado.
    if (bizType === 'SERVICES') {
      const byKey = new Map(base.map((g) => [g.key, g] as const));
      const relabel = (key: string, label: string): NavItem[] => {
        const g = byKey.get(key); return g ? [{ ...g, label }] : [];
      };
      const spine: NavItem[] = [
        base[0], // Visão geral
        { key: 'service-hub', label: 'Centro de comando', icon: IconGauge },
        { key: 'service-orders', label: 'Ordens de serviço', icon: IconStore },
      ];
      const reframed = new Set(['overview', 'products-group', 'movements-group']);
      const rest = base.slice(1).filter((g) => !reframed.has(g.key));
      return [
        ...spine,
        ...relabel('products-group', 'Peças & Stock'),
        ...relabel('movements-group', 'Caixa & Financeiro'),
        ...rest,
      ];
    }

    // Mesmo painel base + itens próprios do vertical (logo a seguir à Visão geral).
    const vert: NavItem[] = [{ key: 'service-hub', label: VERTICAL_LABEL[bizType], icon: IconStore }];
    if (bizType === 'RESTAURANT') vert.push({ key: 'restaurant', label: '🍽️ Mesas & Comandas', icon: IconStore });
    if (bizType === 'SERVICES') vert.push({ key: 'service-orders', label: '🛠️ Ordens de serviço', icon: IconStore });
    if (bizType === 'HOSPITALITY') vert.push({ key: 'hotel', label: 'Quartos & Reservas', icon: IconStore });
    if (bizType === 'CLINIC') vert.push({ key: 'clinic', label: 'Agenda & Pacientes', icon: IconStore });
    if (bizType === 'PHARMACY') vert.push({ key: 'pharmacy', label: '💊 Validade & Lotes', icon: IconStore });
    return [base[0], ...vert, ...base.slice(1)];
  }, [user?.role, bizType, storeEnabled]);
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
      <React.Suspense fallback={<div className="card" style={{ padding: 28, textAlign: 'center' }}><span className="muted">A carregar…</span></div>}>
      {section === 'overview' ? <><FirstSteps onGo={setSection} companyCode={user?.tenantId} /><Overview /></> : null}
      {section === 'service-hub' ? (bizType === 'RESTAURANT' ? <RestaurantHome onGo={setSection} /> : bizType === 'HOSPITALITY' ? <HotelHome onGo={setSection} /> : bizType === 'CLINIC' ? <ClinicHome onGo={setSection} /> : bizType === 'SERVICES' ? <ServicesHome onGo={setSection} /> : <ServiceHub businessType={bizType} onGo={setSection} />) : null}
      {section === 'restaurant' ? <Restaurant onGo={setSection} /> : null}
      {section === 'restaurant-kds' ? <RestaurantKitchen onGo={setSection} /> : null}
      {section === 'service-orders' ? <ServiceOrders /> : null}
      {section === 'hotel' ? <Hotel /> : null}
      {section === 'clinic' ? <Clinic /> : null}
      {section === 'pharmacy' ? <Pharmacy /> : null}
      {section === 'assistant' ? <Assistant /> : null}
      {section === 'subscription' ? <Subscription /> : null}
      {section === 'stores' ? <Stores /> : null}
      {section === 'products' ? <Products /> : null}
      {/* Inventário ÚNICO com abas (Stock, Análise, ABC, Reposição, Valorização,
          Antifraude, Transferências, Localização, Auditoria). */}
      {section === 'inventory' || section === 'inventory-intel' || section === 'stock-analysis' ? <InventoryIntel role={user?.role} /> : null}
      {section === 'stock-movements' ? <StockMovements /> : null}
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
      {section === 'backup' ? <Backup /> : null}
      {section === 'backup-restore' ? <BackupRestore /> : null}
      {section === 'migration' ? <Migration /> : null}
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
    </React.Suspense>
    </Shell>
  );
}

function Gate() {
  const { status, mode, shadow, exitShadow } = useAuth();
  // O domínio principal (ndombaxisystem.com) abre SEMPRE a landing — o login
  // direto vive em admin.ndombaxisystem.com (e nos previews .pages.dev /
  // localhost, onde quem já entrou antes vai direto ao ecrã de login).
  // App INSTALADA (Windows/Android/iOS): é servida pelo protocolo `ndombaxi://`
  // e traz a ponte `window.ndombaxi`. Aí o utilizador JÁ é cliente — a landing
  // de marketing não faz sentido: entra-se sempre direto no LOGIN do gestor.
  const isNativeApp = window.location.protocol === 'ndombaxi:'
    || typeof (window as unknown as { ndombaxi?: unknown }).ndombaxi !== 'undefined';
  const isAdminHost = isNativeApp
    || /^admin\./i.test(window.location.hostname)
    || window.location.hostname.endsWith('.pages.dev')
    || window.location.hostname === 'localhost';
  const [view, setView] = useState<'landing' | 'login' | 'register'>(() => {
    if (isNativeApp) return 'login';           // app instalada → login direto
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
    // Na app instalada não há landing: "voltar" fica no próprio login.
    if (view === 'login') return <Login onBack={() => setView(isNativeApp ? 'login' : 'landing')} onRegister={() => setView('register')} />;
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
  // Página oficial de downloads (/baixar): pública, sem sessão. É para onde a
  // barra de topo e cada cartão de download encaminham o cliente.
  if (typeof window !== 'undefined' && /^\/baixar\/?$/i.test(window.location.pathname)) {
    return <DownloadsPage />;
  }
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
