import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SubscriptionRing } from '../components/SubscriptionRing';
import { UserAvatar, displayName } from '../components/UserAvatar';
import { api, ApiError } from '../api/client';
import type { CashSession, Customer, DocumentIdentity, EmittedInvoice, PaymentType, Product, ReceiptFiscalInfo } from '../api/types';
import { IVA_RATE } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LOGO_ROUND, LOGO_SRC, SYSTEM_SHORT } from '../brand';
import { CustomerModal } from '../components/CustomerModal';
import { FooterCredit } from '../components/FooterCredit';
import {
  IconCart,
  IconCloud,
  IconCloudOff,
  IconCube,
  IconKeyboard,
  IconLogout,
  IconMinus,
  IconPlus,
  IconSearch,
  IconSync,
  IconTrash,
  IconUser,
} from '../components/Icons';
import { ReceiptModal } from '../components/ReceiptModal';
import { DiscountModal } from '../components/DiscountModal';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { SalesHistoryModal } from '../components/SalesHistoryModal';
import { KitchenOrdersModal } from '../components/KitchenOrdersModal';
import { QueueModal } from '../components/QueueModal';
import { ShiftModal } from '../components/ShiftModal';
import { ChatModal } from '../components/ChatModal';
import { CustomerChatModal } from '../components/CustomerChatModal';
import { SelfConsumptionModal } from '../components/SelfConsumptionModal';
import { SalaryAdvanceModal } from '../components/SalaryAdvanceModal';
import { LeaveRequestModal } from '../components/LeaveRequestModal';
import { IdleLock } from '../components/IdleLock';
import { ThemePicker } from '../components/ThemePicker';
import { PaymentModal } from '../components/PaymentModal';
import { IconReceipt } from '../components/Icons';
import { cartTotals, cartTotalsWithDiscount, lineGross, lineIva, lineNet, type CartLine } from '../pos/cart';
import { bestPromoForLine, type PromoRow } from '../pos/promo';
import { useBarcodeScanner } from '../pos/useBarcodeScanner';
import { formatKz, formatNumber } from '../format';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { useKeyboard } from '../keyboard/KeyboardProvider';
import { buildPendingSale, kvGet, kvSet, newUuid, queueSale } from '../offline/db';
import { syncController } from '../offline/sync';
import { useSync } from '../offline/useSync';
import { deviceKey, deviceSettings, normalizeSettings, SETTINGS_EVENT, DEFAULT_DEVICE_SETTINGS, type DeviceSettings } from '../offline/device';
import { setPaper } from '../print';
import { cachedPhoto, rememberPhoto } from '../photoCache';
import { setPosBusy } from '../offline/localServer';
import { espelharTurnoServidor, turnoAbertoLocal } from '../offline/shifts';
import { isNativeApp } from '../config';
import { adjustCatalogStock, syncCatalog } from '../offline/catalog';
import { customersStore } from '../offline/indexedList';
import { setSaleInProgress } from '../pos/saleActivity';
import { decideHydration, describeReconcile, parseStoredCart, reconcileWithCatalog, type StoredCart } from '../pos/cartPersist';
import { discard as discardParked, park, parseParked, resume, type ParkedSale } from '../pos/parkedSales';

const CACHE_PRODUCTS = 'cache:products';
// Dados de apoio da Caixa, também guardados para VENDER 100% OFFLINE (clientes,
// dados do recibo, identidade fiscal da empresa e promoções). Sem isto, offline
// a caixa abria sem cliente/logo/promoções.
const CACHE_CUSTOMERS = 'cache:customers';
const CACHE_RECEIPT = 'cache:receiptInfo';
const CACHE_IDENTITY = 'cache:identity';
const CACHE_PROMOS = 'cache:promotions';
/** Rascunho do carrinho no servidor por apagar (venda concluída sem rede). */
const DRAFT_STALE = 'ndx:cart-draft-stale';
const marcarRascunhoVelho = () => { try { localStorage.setItem(DRAFT_STALE, '1'); } catch { /* ignora */ } };
const readLocal = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
/** Cópia de segurança do carrinho na base local (IndexedDB), além do localStorage. */
const cartBackupKey = (cartKey: string) => `${cartKey}:backup`;
const cartSignature = (lines: CartLine[], customerId: string | null) =>
  `${customerId ?? ''}|${lines.map((l) => `${l.product.id}:${l.quantity}`).join(',')}`;

const ROLE_LABELS: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador',
  STORE_MANAGER: 'Gestor de loja',
  SHIFT_SUPERVISOR: 'Supervisor',
  CASHIER: 'Operador de caixa',
  ATTENDANT: 'Atendedor',
};

/** Nível de cada papel (0 = mais poder), igual ao backend (rbac/roles.enum). */
const ROLE_LEVEL: Record<string, number> = {
  SUPER_ADMIN: 0, COMPANY_ADMIN: 1, REGIONAL_MANAGER: 2, STORE_MANAGER: 3,
  SHIFT_SUPERVISOR: 4, CASHIER: 5, ATTENDANT: 6,
};

/** Chat com clientes da loja: só supervisor e acima (NÃO o operador de caixa). */
function canChatCustomers(role?: string): boolean {
  return (ROLE_LEVEL[role ?? ''] ?? 6) <= ROLE_LEVEL.SHIFT_SUPERVISOR;
}

function grossUnit(p: Product): number {
  return Number(p.unit_price) * (1 + IVA_RATE[p.iva_code] / 100);
}

/** Menu do operador (canto superior direito): avatar + seta → nome, email e
 *  terminar sessão. Fecha ao clicar fora. */
function OperatorMenu({ photo, name, email, role, unread, custUnread, canCustChat, onChat, onCustChat, onSelfConsumption, onSalaryAdvance, onLeave, onDocumento, onLogout }: {
  photo: string | null; name: string; email: string; role: string; unread: number; custUnread: number; canCustChat: boolean; onChat(): void; onCustChat(): void; onSelfConsumption(): void; onSalaryAdvance(): void; onLeave(): void; onDocumento(): void; onLogout(): void;
}) {
  const totalBadge = unread + (canCustChat ? custUnread : 0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const shown = displayName(name, email);
  const go = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="op-menu acct2">
      <button className={`acct2-btn${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)} title={shown}
        aria-label={`Conta de ${shown}`} aria-haspopup="menu" aria-expanded={open}>
        <UserAvatar photo={photo} name={shown} email={email} size={34} />
        {totalBadge > 0 ? <span className="op-badge">{totalBadge > 99 ? '99+' : totalBadge}</span> : null}
        <MenuIcon d={OP_ICONS.chevron} size={15} className="acct2-caret" />
      </button>
      {open ? (
        <div className="acct2-pop" role="menu" aria-label="Conta">
          <div className="acct2-head">
            <UserAvatar photo={photo} name={shown} email={email} size={44} />
            <div className="acct2-who">
              <div className="acct2-name">{shown}</div>
              {email ? <div className="acct2-email">{email}</div> : null}
            </div>
          </div>
          <div className="acct2-role">{role}</div>
          <div className="acct2-group">
            <button role="menuitem" className="acct2-item" onClick={go(onChat)}>
              <MenuIcon d={OP_ICONS.chat} /> Chat com gerente
              {unread > 0 ? <span className="op-item-badge">{unread > 99 ? '99+' : unread}</span> : null}
            </button>
            {canCustChat ? (
              <button role="menuitem" className="acct2-item" onClick={go(onCustChat)}>
                <MenuIcon d={OP_ICONS.bag} /> Chat com clientes
                {custUnread > 0 ? <span className="op-item-badge">{custUnread > 99 ? '99+' : custUnread}</span> : null}
              </button>
            ) : null}
          </div>
          <div className="acct2-group">
            <button role="menuitem" className="acct2-item" onClick={go(onSelfConsumption)}>
              <MenuIcon d={OP_ICONS.cup} /> Consumo próprio
            </button>
            <button role="menuitem" className="acct2-item" onClick={go(onSalaryAdvance)}>
              <MenuIcon d={OP_ICONS.banknote} /> Adiantamento salarial
            </button>
            <button role="menuitem" className="acct2-item" onClick={go(onLeave)}>
              <MenuIcon d={OP_ICONS.calendar} /> Pedir férias / ausência
            </button>
            <button role="menuitem" className="acct2-item" onClick={go(onDocumento)}>
              <MenuIcon d={OP_ICONS.doc} /> Documento
            </button>
          </div>
          <div className="acct2-group">
            <button role="menuitem" className="acct2-item" onClick={go(() => window.dispatchEvent(new Event('ndx-lock')))}>
              <MenuIcon d={OP_ICONS.lock} /> Bloquear ecrã
            </button>
            <button role="menuitem" className="acct2-item danger" onClick={go(onLogout)}>
              <MenuIcon d={OP_ICONS.logout} /> Terminar sessão
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Ícones do menu da conta: traço único 1.75, 24×24. */
const OP_ICONS = {
  chevron: 'M6 9l6 6 6-6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z',
  bag: 'M6 7h12l1 13H5L6 7zM9 7a3 3 0 0 1 6 0',
  cup: 'M5 8h11v6a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M11.5 3v2',
  banknote: 'M3 6.5h18v11H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 9.5v.01M18 14.5v.01',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
} as const;

function MenuIcon({ d, size = 18, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className ?? 'acct2-ic'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

/** Iniciais do produto (sem foto) e cor estável — iguais às do painel. */
function monoOf(name: string): string {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => /\p{L}/u.test(x));
  if (!w.length) return (name.trim()[0] ?? '?').toUpperCase();
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}
const MONO = ['#2430E8', '#4338CA', '#0E7490', '#0F766E', '#6D28D9', '#BE185D', '#B45309', '#334155'];
function monoColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONO[h % MONO.length];
}

export function PosPage() {
  const { user, logout, companyCode } = useAuth();
  const kbd = useKeyboard();
  const sync = useSync();
  const [operatorPhoto, setOperatorPhoto] = useState<string | null>(null);

  // Foto do operador logado (do RH) para o cabeçalho — sem foto fica o ícone.
  useEffect(() => {
    if (!companyCode || !user?.sub) return;
    let alive = true;
    setOperatorPhoto(cachedPhoto(user.email));
    const done = (p: string | null) => { if (!alive) return; setOperatorPhoto(p); rememberPhoto(user.email, p); };
    api.myPhoto()
      .then((r) => r.photoUrl ?? api.operators(companyCode).then((o) => o.operators.find((x) => x.id === user.sub)?.photo_url ?? null))
      .then(done)
      .catch(() => { /* sem rede → foto guardada ou ícone */ });
    return () => { alive = false; };
  }, [companyCode, user?.sub, user?.email]);

  const [products, setProducts] = useState<Product[]>([]);
  // Definições desta caixa (Admin → Lojas → Caixas). Guardadas no aparelho.
  const [regCfg, setRegCfg] = useState<DeviceSettings>(DEFAULT_DEVICE_SETTINGS);
  useEffect(() => {
    let alive = true;
    const apply = (c: DeviceSettings) => { if (!alive) return; setRegCfg(c); if (c.paperWidth) setPaper(c.paperWidth); };
    void deviceSettings().then(apply);
    const on = (e: Event) => apply(normalizeSettings((e as CustomEvent).detail));
    window.addEventListener(SETTINGS_EVENT, on);
    return () => { alive = false; window.removeEventListener(SETTINGS_EVENT, on); };
  }, []);
  // Disponibilidade dos produtos de PRODUÇÃO + prompt de solicitação à cozinha.
  const [availMap, setAvailMap] = useState<Record<string, 'FREE' | 'BUSY' | 'OUT'>>({});
  const [prodPrompt, setProdPrompt] = useState<{ product: Product; status: 'BUSY' | 'OUT' } | null>(null);
  const [promotions, setPromotions] = useState<PromoRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [receiptInfo, setReceiptInfo] = useState<ReceiptFiscalInfo | null>(null);
  const [identity, setIdentity] = useState<DocumentIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  // Carrinho PERSISTENTE por operador (sobrevive a quebra de energia / fecho
  // acidental, até ser finalizado ou limpo pelo MESMO funcionário). Multiutilizador:
  // cada operador tem a sua chave, e o stock é sempre reconfirmado no servidor.
  const cartKey = user?.sub ? `pos:cart:${user.sub}` : null;
  // Chave cujo conteúdo já foi carregado para o estado. Enquanto não coincidir com
  // `cartKey`, a persistência NÃO escreve — senão um carrinho vazio do 1.º render
  // (utilizador ainda por decidir) apagava o que estava guardado (B-03).
  const loadedKeyRef = useRef<string | null>(null);
  // Cópia guardada mais recente (com updatedAt/syncedAt) — base da hidratação (B-01).
  const storedRef = useRef<StoredCart<Product> | null>(null);
  // O próximo conteúdo gravado veio do SERVIDOR → já está sincronizado.
  const fromServerRef = useRef(false);
  const [cart, setCart] = useState<CartLine[]>(() => {
    const s = cartKey ? parseStoredCart<Product>(readLocal(cartKey)) : null;
    storedRef.current = s;
    loadedKeyRef.current = cartKey;
    return s?.lines ?? [];
  });
  const cartRef = useRef(cart);
  cartRef.current = cart;
  // O cliente da venda guardada já foi reposto (ou a lista de clientes chegou)?
  const customerRestoredRef = useRef(false);
  const [cartStorageWarn, setCartStorageWarn] = useState(false);
  // Vendas SUSPENSAS deste operador (paridade Vendus: "Nova Venda" estaciona a
  // atual). Persistidas no aparelho: sobrevivem a refresh, fecho e falta de rede.
  const parkedKey = user?.sub ? `pos:parked:${user.sub}` : null;
  const [parked, setParked] = useState<ParkedSale<CartLine>[]>(() => (parkedKey ? parseParked<CartLine>(readLocal(parkedKey)) : []));
  const [showParked, setShowParked] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [cartSel, setCartSel] = useState<Set<string>>(new Set());
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSales, setShowSales] = useState(false);
  // Balcão → cozinha: modal de pedidos prontos + comanda a saldar (chamada da cozinha).
  const [showKitchen, setShowKitchen] = useState(false);
  // Notificação em tempo real: nº de pedidos de produção PRONTOS para o caixa chamar.
  const [kitchenReady, setKitchenReady] = useState(0);
  const kitchenReadyPrev = useRef(0);
  const recalledOrderIdRef = useRef<string | null>(null);

  // Turno de caixa
  const [session, setSession] = useState<CashSession | null>(null);
  const [showShift, setShowShift] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  // ── Layout do POS de referência: menus do topo, separadores de categorias,
  // painel "Opções" e linhas da venda expansíveis ──
  const [topMenu, setTopMenu] = useState<'auto' | 'caixa' | 'docs' | null>(null);
  const topMenuRef = useRef<HTMLElement | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [catMenu, setCatMenu] = useState(false);
  const catMenuRef = useRef<HTMLDivElement | null>(null);
  const [catFilter, setCatFilter] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [optsOpen, setOptsOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(null);
  useEffect(() => { api.categories().then(setCategories).catch(() => undefined); }, []);
  // Fecha os menus do topo e o de categorias ao clicar fora / Esc.
  useEffect(() => {
    if (!topMenu && !catMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (topMenuRef.current?.contains(t) || catMenuRef.current?.contains(t)) return;
      setTopMenu(null); setCatMenu(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setTopMenu(null); setCatMenu(false); } };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [topMenu, catMenu]);
  // Chat de equipa (caixa ↔ gerente): badge de não-lidas + janela.
  const [showChat, setShowChat] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [showCustChat, setShowCustChat] = useState(false);
  const [custUnread, setCustUnread] = useState(0);
  const [showConsumption, setShowConsumption] = useState(false);
  const [showAdvance, setShowAdvance] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  // O operador de caixa não tem chat com clientes — só supervisor e acima.
  const custChatAllowed = canChatCustomers(user?.role);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      api.chatUnread().then((r) => { if (alive) setChatUnread(r.count); }).catch(() => undefined);
      if (custChatAllowed) api.custChatUnread().then((r) => { if (alive) setCustUnread(r.count); }).catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 10000);
    return () => { alive = false; window.clearInterval(t); };
  }, [custChatAllowed]);

  const [emitting, setEmitting] = useState(false);
  const [emitError, setEmitError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);
  const [emitted, setEmitted] = useState<
    { invoice: EmittedInvoice; customerName: string | null; items?: { description: string; quantity: number; unitPrice: number; total: number }[]; provisional?: boolean; pay?: { paymentType: PaymentType; tendered?: number; changeGiven?: number; payments?: { type: Exclude<PaymentType, 'CREDIT'>; amount: number }[] } } | null
  >(null);

  // Constrói as linhas de artigos (descrição, qt, preço unit. c/IVA, total) para a fatura.
  // Fatura a cliente com NIF: o NIF do adquirente tem de constar no documento.
  const receiptCustomer = (c: typeof customer) => (c ? (c.tax_id?.trim() && c.tax_id.trim() !== '999999999' ? `${c.name} · NIF ${c.tax_id.trim()}` : c.name) : null);
  const buildItems = (lines: CartLine[]) => lines.map((l) => {
    // Desconto da linha (promoção ou manual) — o talão tem de bater com o total emitido.
    const rate = discountRateByProduct[l.product.id] ?? 0;
    const gross = lineGross(l);
    const total = Math.round(gross * (1 - rate) * 100) / 100;
    const net = Math.round(lineNet(l) * (1 - rate) * 100) / 100;
    return {
      code: l.product.code, description: l.product.name, quantity: l.quantity, unitPrice: l.quantity ? Math.round((gross / l.quantity) * 100) / 100 : gross, total,
      discount: Math.round((gross - total) * 100) / 100, discountRate: rate,
      // Para o quadro de IVA por taxa e o motivo de isenção no talão (menções obrigatórias).
      ivaRate: IVA_RATE[l.product.iva_code], net, iva: rate > 0 ? Math.round((total - net) * 100) / 100 : lineIva(l), exemptionCode: l.product.exemption_code ?? null,
    };
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await api.listProducts();
        setProducts(list);
        void kvSet(CACHE_PRODUCTS, list); // guarda p/ abrir offline da próxima vez
      } catch (e) {
        // Sem rede: tenta a cache local para a caixa abrir mesmo offline.
        const cached = await kvGet<Product[]>(CACHE_PRODUCTS);
        if (cached && cached.length > 0) {
          setProducts(cached);
        } else {
          setError(e instanceof ApiError ? e.message : 'Falha ao carregar produtos.');
        }
      } finally {
        setLoading(false);
      }
      // Dados de apoio: ONLINE → aplica e cacheia; OFFLINE → lê da cache local
      // (para a Caixa vender 100% sem rede — com cliente, recibo, logo e promoções).
      const cached = async <T,>(key: string, fetcher: () => Promise<T>, setter: (v: T) => void) => {
        try { const v = await fetcher(); setter(v); void kvSet(key, v); }
        catch { const c = await kvGet<T>(key); if (c != null) setter(c); }
      };
      void cached(CACHE_CUSTOMERS, () => api.listCustomers(), setCustomers);
      void cached(CACHE_RECEIPT, () => api.receiptInfo(), setReceiptInfo);
      void cached(CACHE_IDENTITY, () => api.documentIdentity(), setIdentity);
      void cached(CACHE_PROMOS, () => api.listPromotions(), setPromotions);
      // A sessão (turno aberto) é dinâmica — não se cacheia.
      // O servidor é a autoridade sobre o turno. SEM REDE, vale o turno aberto
      // NESTE aparelho — senão a Caixa abria sem turno e o operador não
      // conseguia começar o dia numa loja sem internet.
      api.currentSession().then((s) => { setSession(s); void espelharTurnoServidor(s); }).catch(async () => {
        const t = await turnoAbertoLocal();
        if (t) {
          setSession({
            id: t.opId,
            register_code: t.registerCode,
            opened_by_name: t.operatorName,
            opened_at: t.openedAt,
            opening_float: String(t.openingFloat),
            status: 'OPEN',
          });
        }
      });
    })();
  }, []);

  // Atualização em TEMPO REAL do stock/catálogo: refaz a lista do servidor
  // (após cada venda/cancelamento e periodicamente), sem o utilizador recarregar.
  // Assinaturas do último catálogo/disponibilidade recebidos. Este polling corre
  // de 12 em 12 s (e a cada foco/visibilidade): sem esta guarda, cada volta fazia
  // `setProducts` com um array NOVO e re-renderizava a grelha inteira mesmo quando
  // nada mudou — o "engasgo" durante o uso. Só atualizamos o estado quando os
  // dados mudaram de facto (UI idêntica, zero render desperdiçado).
  const productsSig = useRef('');
  const availSig = useRef('');
  const refreshProducts = useCallback(async () => {
    try {
      const list = await api.listProducts();
      const sig = JSON.stringify(list);
      if (sig !== productsSig.current) {
        productsSig.current = sig;
        setProducts(list);
        void kvSet(CACHE_PRODUCTS, list);
      }
    } catch { /* offline: mantém a cache */ }
    // Disponibilidade dos produtos de PRODUÇÃO (🟢/🟡/🔴). Vertical não-restaurante
    // ou offline: fica vazio → produtos comportam-se como hoje.
    try {
      const av = await api.productionAvailability();
      const sig = JSON.stringify(av);
      if (sig !== availSig.current) {
        availSig.current = sig;
        setAvailMap(Object.fromEntries(av.map((r) => [r.id, r.status])));
      }
    } catch { /* sem restauração: ignora */ }
  }, []);

  // Notificação de cozinha: sonda os pedidos PRONTOS e mantém o badge do botão
  // "Cozinha" atualizado sem recarregar. Beep curto (WebAudio) quando surge um novo.
  const pollKitchenReady = useCallback(async () => {
    try {
      const rows = await api.readyKitchenOrders();
      const n = rows.filter((r) => r.ready).length;
      if (n > kitchenReadyPrev.current) {
        try {
          const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
          if (Ctx) { const ac = new Ctx(); const o = ac.createOscillator(); const g = ac.createGain();
            o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.value = 0.05;
            o.start(); o.stop(ac.currentTime + 0.18); }
        } catch { /* som opcional */ }
      }
      kitchenReadyPrev.current = n;
      setKitchenReady(n);
    } catch { /* sem restauração / offline: ignora */ }
  }, []);
  useEffect(() => {
    if (!sync.online) return;
    void pollKitchenReady();
    // Não sondar em segundo plano: com o separador/janela oculto o operador não
    // está a ver o badge, e o timer continuava a bater na API à toa (pior em
    // rede lenta). Ao voltar à frente, sondamos já.
    const t = window.setInterval(() => { if (!document.hidden) void pollKitchenReady(); }, 12000);
    const onVisible = () => { if (document.visibilityState === 'visible') void pollKitchenReady(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync.online, pollKitchenReady]);

  useEffect(() => {
    if (!sync.online) return;
    // Idem: o intervalo periódico não corre em segundo plano; o refresh ao voltar
    // ao separador/ganhar foco (abaixo) mantém o catálogo fresco quando é visível.
    const t = window.setInterval(() => { if (!document.hidden) void refreshProducts(); }, 12000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshProducts(); };
    const onFocus = () => { void refreshProducts(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [sync.online, refreshProducts]);

  // CATÁLOGOS GRANDES: a grelha mostra os primeiros 300; a PESQUISA vai ao servidor
  // (ou à memória interna, sem rede) — nome, código, código de barras e marca.
  const [searchHits, setSearchHits] = useState<Product[]>([]);
  useEffect(() => {
    const q = search.trim();
    if (!q) { setSearchHits([]); return; }
    let vivo = true;
    const t = window.setTimeout(() => {
      api.listProducts({ q, limit: 100 }).then((r) => { if (vivo) setSearchHits(r); }).catch(() => undefined);
    }, 250);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [search]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    const local = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q),
    );
    const ids = new Set(local.map((p) => p.id));
    return [...local, ...searchHits.filter((p) => !ids.has(p.id))];
  }, [products, search, searchHits]);
  /** Separadores: só as categorias que têm produtos carregados (como na referência). */
  const catTabs = useMemo(() => {
    const used = new Set(products.map((p) => p.category_id).filter(Boolean) as string[]);
    return categories.filter((c) => used.has(c.id));
  }, [categories, products]);
  /** Grelha: pesquisa tem prioridade; sem pesquisa, filtra pela categoria escolhida. */
  const shown = useMemo(
    () => (search.trim() || !catFilter ? filtered : filtered.filter((p) => p.category_id === catFilter)),
    [filtered, catFilter, search],
  );  /** Procura UM produto por código/código de barras: primeiro no que já está carregado,
   *  depois no servidor/memória interna (catálogos que não cabem na grelha). */
  const lookupCode = useCallback(async (code: string): Promise<Product | null> => {
    const c = code.trim().toLowerCase();
    const isExact = (p: Product) => (p.barcode ?? '').toLowerCase() === c || p.code.toLowerCase() === c;
    const local = products.find(isExact) ?? searchHits.find(isExact);
    if (local) return local;
    try { return (await api.listProducts({ q: code.trim(), limit: 5 })).find(isExact) ?? null; } catch { return null; }
  }, [products, searchHits]);
  // Memória interna do catálogo (app instalada): sincroniza as alterações em 2.º plano.
  useEffect(() => {
    if (!isNativeApp() || !companyCode) return;
    const run = () => {
      void syncCatalog(companyCode, async (since, after) => (await api.productChanges(since, after)) as never).catch(() => undefined);
      void customersStore.sync(companyCode, async (since, after) => (await api.customerChanges(since, after)) as never).catch(() => undefined);
    };
    run();
    const t = window.setInterval(run, 3 * 60_000);
    return () => window.clearInterval(t);
  }, [companyCode]);

  // Promoções: desconto por linha (em tempo real, espelha o backend).
  const promoByProduct = useMemo(() => {
    const out: Record<string, { discount: number; discountRate: number; name: string | null }> = {};
    for (const l of cart) {
      const unitGross = grossUnit(l.product);
      out[l.product.id] = bestPromoForLine(
        { productId: l.product.id, categoryId: l.product.category_id, unitGross, quantity: l.quantity },
        promotions,
      );
    }
    return out;
  }, [cart, promotions]);

  // Desconto MANUAL por artigo (aprovado por supervisor/gerente). Vale o maior
  // entre a promoção e o manual — não acumulam.
  const [manualDisc, setManualDisc] = useState<Record<string, number>>({});
  const [discApproval, setDiscApproval] = useState<{ pin: string; name: string } | null>(null);
  const [discLine, setDiscLine] = useState<CartLine | null>(null);
  useEffect(() => { if (cart.length === 0) { setManualDisc({}); setDiscApproval(null); } }, [cart.length]);
  const hasManual = cart.some((l) => (manualDisc[l.product.id] ?? 0) > (promoByProduct[l.product.id]?.discountRate ?? 0));

  const discountRateByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const id in promoByProduct) m[id] = Math.max(promoByProduct[id].discountRate, manualDisc[id] ?? 0);
    return m;
  }, [promoByProduct, manualDisc]);

  const totals = cartTotalsWithDiscount(cart, discountRateByProduct);

  const flashError = (m: string) => { setEmitError(m); setTimeout(() => setEmitError(null), 2500); };
  const flashOk = (m: string) => { setOkMsg(m); setTimeout(() => setOkMsg(null), 3200); };

  /** Lança o produto no carrinho. Devolve `true` SÓ se foi realmente lançado
   *  (não esgotado / com stock) — para o campo de pesquisa só limpar nesse caso. */
  const addToCart = (p: Product): boolean => {
    setEmitError(null);
    // PRODUÇÃO: a venda passa pela disponibilidade. Livre → vende normalmente;
    // Ocupado/Esgotado → NUNCA vende já; abre o prompt para solicitar produção.
    if (p.is_production) {
      const st = availMap[p.id];
      if (st === 'BUSY' || st === 'OUT') { setProdPrompt({ product: p, status: st }); return false; }
      // FREE (ou desconhecido): segue para a venda normal a partir da prateleira.
    }
    const stock = Number(p.stock_qty);
    // Prato com ficha técnica: produzido SOB ENCOMENDA — o stock próprio é 0
    // por natureza (quem conta são os ingredientes; a emissão valida-os e dá
    // mensagem clara se faltar algum). Sem isto, a restauração não conseguia
    // vender nenhum prato no POS ("está esgotado").
    const madeToOrder = !!p.has_recipe;
    if (!madeToOrder && stock <= 0) { flashError(`"${p.name}" está esgotado.`); return false; }
    // Prato sem ingredientes para 1 dose E sem fornada na prateleira: avisa JÁ
    // no toque (em vez de deixar o erro para o pagamento). Com stock produzido
    // (padaria), vende da prateleira mesmo sem ingredientes. A emissão valida.
    const portions = p.portions_available == null ? null : Number(p.portions_available);
    if (madeToOrder && stock <= 0 && portions != null && portions <= 0) {
      flashError(`Ingredientes esgotados para "${p.name}" — reponha o stock dos ingredientes.`);
      return false;
    }
    const current = cart.find((l) => l.product.id === p.id)?.quantity ?? 0;
    if (!madeToOrder && current + 1 > stock) { flashError(`Stock insuficiente de "${p.name}": só há ${stock}.`); return false; }
    // AVISO de reserva (não bloqueia): este stock está prometido a uma encomenda
    // online por confirmar. O cliente físico tem prioridade, mas o caixa é
    // avisado para o conflito não passar despercebido (a mesma água vendida 2×).
    const reserved = Math.max(0, Math.floor(Number(p.reserved ?? 0)));
    if (!madeToOrder && !p.is_production && reserved > 0 && current + 1 > stock - reserved) {
      flashError(`"${p.name}": ${reserved} reservado(s) para encomenda online. Confirme antes de vender.`);
      // não faz return — a venda continua (prioridade ao cliente presente).
    }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { product: p, quantity: 1 }];
    });
    return true;
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.product.id !== id) return l;
          const stock = Number(l.product.stock_qty);
          const next = l.quantity + delta;
          // Pratos sob encomenda não têm stock próprio (ver addToCart).
          if (!l.product.has_recipe && delta > 0 && next > stock) { flashError(`Stock insuficiente de "${l.product.name}": só há ${stock}.`); return l; }
          return { ...l, quantity: next };
        })
        .filter((l) => l.quantity > 0),
    );
  };

  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.product.id !== id));

  // Só o gerente/gestor pode cancelar vendas.
  const canCancel = ['COMPANY_ADMIN', 'STORE_MANAGER'].includes(user?.role ?? '');

  // ── Limpar carrinho (selecionar cada linha ou tudo) ──────────
  const toggleCartSel = (id: string) =>
    setCartSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allCartSel = cart.length > 0 && cart.every((l) => cartSel.has(l.product.id));
  const toggleAllCart = () => setCartSel(allCartSel ? new Set() : new Set(cart.map((l) => l.product.id)));
  const clearCart = () => {
    if (cartSel.size > 0) {
      setCart((prev) => prev.filter((l) => !cartSel.has(l.product.id)));
      setCartSel(new Set());
    } else {
      setCart([]);
    }
  };

  // Troca de operador/chave: carrega o carrinho guardado dessa chave ANTES de
  // permitir qualquer escrita (B-03). Se o localStorage não tiver nada, tenta a
  // cópia de segurança na base local (IndexedDB).
  useEffect(() => {
    if (!cartKey || loadedKeyRef.current === cartKey) return;
    let cancel = false;
    const s = parseStoredCart<Product>(readLocal(cartKey));
    if (s) {
      storedRef.current = s;
      loadedKeyRef.current = cartKey;
      setCart(s.lines);
      return;
    }
    void kvGet<StoredCart<Product>>(cartBackupKey(cartKey)).then((b) => {
      if (cancel) return;
      const backup = b ? parseStoredCart<Product>(JSON.stringify(b)) : null;
      storedRef.current = backup;
      loadedKeyRef.current = cartKey;
      if (backup?.lines.length) setCart(backup.lines);
    }).catch(() => { if (!cancel) loadedKeyRef.current = cartKey; });
    return () => { cancel = true; };
  }, [cartKey]);

  // Persiste o carrinho do operador IMEDIATAMENTE após cada alteração:
  // localStorage (síncrono, sobrevive a refresh/fecho) + cópia na base local.
  // Falha de escrita deixa de ser silenciosa (B-05).
  useEffect(() => {
    if (!cartKey || loadedKeyRef.current !== cartKey) return;
    const now = Date.now();
    const synced = fromServerRef.current;
    fromServerRef.current = false;
    const prev = storedRef.current;
    // Cliente ainda por restaurar (lista de clientes a carregar): mantém o guardado.
    const customerId = customer?.id ?? (customerRestoredRef.current ? null : prev?.customerId ?? null);
    // Só conta como ALTERAÇÃO o que muda a venda (artigos, quantidades, cliente) —
    // não um preço/stock atualizado do catálogo; senão cada refresh tornava o local
    // "mais recente" que o servidor e a hidratação entre aparelhos nunca aplicava.
    const changed = !prev || cartSignature(prev.lines, prev.customerId) !== cartSignature(cart, customerId);
    const stored: StoredCart<Product> = {
      v: 2,
      lines: cart,
      customerId,
      updatedAt: synced ? now : changed ? now : (prev?.updatedAt ?? now),
      syncedAt: synced ? now : (prev?.syncedAt ?? 0),
    };
    storedRef.current = stored;
    let ok = true;
    try {
      if (cart.length) localStorage.setItem(cartKey, JSON.stringify(stored));
      else localStorage.removeItem(cartKey);
    } catch { ok = false; }
    void (cart.length ? kvSet(cartBackupKey(cartKey), stored) : kvSet(cartBackupKey(cartKey), null))
      .then(() => { if (!ok) setCartStorageWarn(false); })
      .catch(() => { if (!ok) setCartStorageWarn(true); });
    if (ok) setCartStorageWarn(false);
  }, [cart, cartKey, customer]);

  // Troca de operador: carrega as vendas suspensas DESSE operador.
  const parkedLoadedRef = useRef(parkedKey);
  useEffect(() => {
    if (parkedLoadedRef.current === parkedKey) return;
    parkedLoadedRef.current = parkedKey;
    setParked(parkedKey ? parseParked<CartLine>(readLocal(parkedKey)) : []);
  }, [parkedKey]);
  // Persiste as vendas suspensas a cada alteração (localStorage + base local).
  useEffect(() => {
    if (!parkedKey || parkedLoadedRef.current !== parkedKey) return;
    try {
      if (parked.length) localStorage.setItem(parkedKey, JSON.stringify(parked));
      else localStorage.removeItem(parkedKey);
    } catch { setCartStorageWarn(true); }
    void kvSet(`${parkedKey}:backup`, parked.length ? parked : null).catch(() => undefined);
  }, [parked, parkedKey]);

  /** "Nova venda": suspende a atual (se tiver artigos) e começa uma vazia. */
  const parkCurrent = () => {
    const r = park(parked, { lines: cart, customerId: customer?.id ?? null }, newUuid(), Date.now());
    if (r.full) { flashError('Limite de vendas suspensas atingido. Retome ou descarte uma venda suspensa.'); return; }
    if (!r.parked) return;
    setParked(r.list);
    setCart([]); setCartSel(new Set()); setCustomer(null);
  };

  /** Retoma uma venda suspensa; a atual (se tiver artigos) fica suspensa no lugar. */
  const resumeParked = (id: string) => {
    const r = resume(parked, id, { lines: cart, customerId: customer?.id ?? null }, newUuid(), Date.now());
    if (!r.sale) return;
    // Preços e stock reconfirmados com o catálogo atual — com aviso do que mudou.
    const rec = products.length ? reconcileWithCatalog(r.sale.lines, products) : null;
    setParked(r.list);
    setCart(rec ? rec.lines : r.sale.lines);
    setCartSel(new Set());
    const c = r.sale.customerId ? customers.find((x) => x.id === r.sale!.customerId) ?? null : null;
    setCustomer(c);
    setShowParked(false);
    const msg = rec ? describeReconcile(rec) : null;
    if (msg) { setEmitError(msg); setTimeout(() => setEmitError(null), 8000); }
  };

  const discardParkedSale = (id: string) => {
    if (confirmDiscard !== id) { setConfirmDiscard(id); return; }
    setParked((prev) => discardParked(prev, id));
    setConfirmDiscard(null);
  };

  // Repõe o cliente da venda guardada quando a lista de clientes chega (online
  // ou da cache local) — o cliente associado sobrevive a refresh/reinício.
  useEffect(() => {
    if (customerRestoredRef.current || customers.length === 0) return;
    customerRestoredRef.current = true;
    const id = storedRef.current?.customerId;
    if (id && !customer && cartRef.current.length) {
      const c = customers.find((x) => x.id === id);
      if (c) setCustomer(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers]);

  // Diz ao posto que a caixa está OCUPADA — turno aberto, carrinho com artigos
  // ou fatura a ser emitida. É o único sinal que só este ecrã tem, e é o que
  // impede a cópia da empresa (dezenas de milhares de linhas) de arrancar com
  // um cliente à espera no balcão. Não muda nada na interface.
  useEffect(() => {
    setPosBusy(session != null || cart.length > 0 || emitting);
  }, [session, cart.length, emitting]);
  // Ao sair deste ecrã a caixa deixa de estar ocupada — senão uma bandeira
  // presa adiava a cópia para sempre.
  useEffect(() => () => setPosBusy(false), []);

  // Venda em curso: sinal lido pela auto-atualização para nunca recarregar a app
  // a meio de uma venda. É MAIS ESTREITO que "ocupada" acima — um turno aberto
  // sem carrinho não deve adiar a atualização, senão a app nunca se atualizaria
  // durante o dia de trabalho.
  useEffect(() => {
    setSaleInProgress(cart.length > 0 || emitting);
  }, [cart.length, emitting]);
  useEffect(() => () => setSaleInProgress(false), []);

  // Reconcilia o carrinho com o STOCK ATUAL (ex.: outro caixa vendeu entretanto):
  // remove o que esgotou/saiu do catálogo e ajusta quantidades ao disponível.
  // Pratos SOB ENCOMENDA (ficha técnica) nunca são removidos nem limitados aqui
  // (o stock real está nos ingredientes; a emissão valida-os). O que for retirado
  // ou ajustado é AVISADO ao funcionário — nunca desaparece em silêncio (B-02).
  useEffect(() => {
    if (products.length === 0 || cartRef.current.length === 0) return;
    const r = reconcileWithCatalog(cartRef.current, products);
    if (!r.changed) return;
    setCart(r.lines);
    const msg = describeReconcile(r);
    if (msg) { setEmitError(msg); setTimeout(() => setEmitError(null), 8000); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // HIDRATAÇÃO CROSS-DEVICE: ao ligar (em QUALQUER dispositivo), recupera do
  // SERVIDOR o carrinho por finalizar deste operador. O catálogo é necessário
  // para reconstruir as linhas; o stock é reconfirmado (clamp ao disponível).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || products.length === 0) return;
    hydratedRef.current = true;
    (async () => {
      try {
        // Uma venda concluída SEM rede não conseguiu apagar o rascunho no servidor:
        // apaga-o agora e não o restaura (senão voltavam artigos já vendidos).
        let stale = false;
        try { stale = localStorage.getItem(DRAFT_STALE) === '1'; } catch { /* ignora */ }
        if (stale) {
          await api.clearCartDraft();
          try { localStorage.removeItem(DRAFT_STALE); } catch { /* ignora */ }
          return;
        }
        const draft = await api.getCartDraft();
        const serverHasLines = !!draft && Array.isArray(draft.lines) && draft.lines.length > 0;
        // B-01: alterações locais ainda não enviadas (ex.: feitas sem rede) ganham
        // SEMPRE ao rascunho do servidor — nunca são substituídas às cegas.
        if (decideHydration(storedRef.current, serverHasLines) === 'local') return;
        if (!serverHasLines) {
          // Local já sincronizado e servidor vazio: a venda foi concluída/limpa
          // noutro aparelho deste operador.
          if (cartRef.current.length) { fromServerRef.current = true; setCart([]); }
          return;
        }
        if (draft && Array.isArray(draft.lines) && draft.lines.length) {
          const lines: CartLine[] = [];
          for (const d of draft.lines) {
            const p = products.find((x) => x.id === d.productId);
            if (!p) continue;
            // Sob encomenda (ficha técnica): stock próprio 0 por natureza — hidrata
            // na mesma (não descartar por stock<=0). Ver reconciliação acima.
            const madeToOrder = !!p.has_recipe;
            const stock = Number(p.stock_qty);
            if (!madeToOrder && stock <= 0) continue;
            lines.push({ product: p, quantity: madeToOrder ? d.quantity : Math.min(d.quantity, stock) });
          }
          if (lines.length) { fromServerRef.current = true; setCart(lines); }
          if (draft.customerId) {
            const c = customers.find((x) => x.id === draft.customerId);
            if (c) setCustomer(c);
          }
        }
      } catch { /* offline → mantém o cache local deste dispositivo */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // Sincroniza o carrinho para o SERVIDOR (debounce) → segue o operador para
  // outro dispositivo. Offline mantém só o cache local; volta a sincronizar online.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!hydratedRef.current || !sync.online) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // Marca como sincronizado SÓ o conteúdo que o servidor confirmou.
      const sent = storedRef.current?.updatedAt ?? 0;
      const markSynced = () => {
        const s = storedRef.current;
        if (!s || s.updatedAt !== sent || !cartKey) return;
        const next = { ...s, syncedAt: s.updatedAt };
        storedRef.current = next;
        try { if (next.lines.length) localStorage.setItem(cartKey, JSON.stringify(next)); } catch { /* aviso já tratado na persistência */ }
        if (next.lines.length) void kvSet(cartBackupKey(cartKey), next).catch(() => undefined);
      };
      if (cart.length === 0) void api.clearCartDraft().then(markSynced).catch(() => undefined);
      else void api.saveCartDraft(cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })), customer?.id ?? null).then(markSynced).catch(() => undefined);
    }, 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [cart, customer, sync.online]);

  /**
   * Resolve um código lido (leitor físico, câmara ou Enter na pesquisa):
   * procura por código de barras / código EXACTO; lança ao carrinho e LIMPA a
   * pesquisa (auto-enter), pronto para a próxima leitura.
   */
  const scanPending = useRef(new Set<string>());
  const scanResolve = (raw: string): boolean => {
    const code = raw.trim();
    if (!code) return false;
    const found = products.find(
      (p) => (p.barcode && p.barcode === code) || p.code.toLowerCase() === code.toLowerCase(),
    );
    if (!found) {
      // Não está na grelha (catálogo grande): procura no servidor/memória interna.
      if (scanPending.current.has(code)) return false;
      scanPending.current.add(code);
      void lookupCode(code).then((p) => {
        if (p) { if (addToCart(p)) setSearch(''); else setSearch(code); }
        else { setSearch(code); flashError(`Código não encontrado: ${code}`); }
      }).finally(() => { scanPending.current.delete(code); });
      return false;
    }
    if (found) {
      // Regra: só limpa o campo DEPOIS de lançar mesmo o produto no carrinho.
      const added = addToCart(found);
      if (added) { setSearch(''); return true; } // câmara faz bip e fecha só aqui
      setSearch(code); // encontrado mas não lançado (esgotado) → mantém o código
      return false;
    }
    setSearch(code);
    flashError(`Código não encontrado: ${code}`);
    return false;
  };

  /** Enter na pesquisa = auto-enter: resolve por código exacto ou, se houver só
   *  1 resultado filtrado, lança esse. */
  const onSearchEnter = () => {
    const q = search.trim();
    if (!q) return;
    const exact = products.find((p) => (p.barcode && p.barcode === q) || p.code.toLowerCase() === q.toLowerCase());
    if (exact) { if (addToCart(exact)) setSearch(''); return; }
    if (filtered.length === 1) { if (addToCart(filtered[0])) setSearch(''); return; }
    void lookupCode(q).then((p) => {
      if (p) { if (addToCart(p)) setSearch(''); return; }
      flashError(filtered.length ? 'Vários resultados — toque no produto ou leia o código.' : `Código não encontrado: ${q}`);
    });
  };

  // Leitor de código de barras FÍSICO (keyboard-wedge): lê e lança ao carrinho.
  useBarcodeScanner((code) => scanResolve(code));

  // AUTO-ENTER no campo de pesquisa: assim que o que está escrito corresponder
  // EXACTAMENTE ao código de barras / código de um produto (scanner que NÃO
  // envia Enter, ou digitação), lança automaticamente e limpa o campo — sem o
  // utilizador clicar/Enter. (A pesquisa por NOME continua manual, para não
  // lançar produtos errados.)
  useEffect(() => {
    const q = search.trim();
    if (!q) return;
    const t = window.setTimeout(() => {
      const isExact = (p: Product) => (p.barcode && p.barcode === q) || p.code.toLowerCase() === q.toLowerCase();
      const exact = products.find(isExact) ?? searchHits.find(isExact);
      if (exact && addToCart(exact)) setSearch('');
    }, 140);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, products, searchHits]);

  /** Guarda a venda na fila offline e mostra um comprovativo PROVISÓRIO. */
  /**
   * @param clientOpId chave da tentativa online que falhou por REDE. Reutilizá-la
   *   é o que impede a duplicação fiscal no caso pior: o servidor tinha gravado a
   *   fatura e só a RESPOSTA se perdeu — ao reenviar da fila com a mesma chave, o
   *   servidor devolve a fatura original em vez de emitir uma segunda.
   */
  const finalizeOffline = async (clientOpId?: string, pay?: { paymentType: PaymentType; tendered?: number; changeGiven?: number; payments?: { type: Exclude<PaymentType, 'CREDIT'>; amount: number }[] }) => {
    const sale = { ...buildPendingSale(cart, totals, customer ? { id: customer.id, name: customer.name } : null, clientOpId, pay, discountRateByProduct), docType: regCfg.defaultDocType };
    await queueSale(sale);
    // Memória partilhada com o Gestão: o stock desce já, antes de a venda subir.
    if (companyCode) for (const l of sale.lines) void adjustCatalogStock(companyCode, l.productCode, -l.quantity).catch(() => undefined);
    await syncController.refreshCount();
    // Recibo provisório: o nº/hash fiscais reais vêm do servidor ao sincronizar.
    const provisionalInvoice: EmittedInvoice = {
      id: sale.localRef,
      number: sale.localRef,
      hash: '',
      previousHash: '',
      netTotal: totals.net,
      ivaTotal: totals.iva,
      grossTotal: totals.gross,
    };
    setEmitted({ invoice: provisionalInvoice, customerName: receiptCustomer(customer), items: buildItems(cart), provisional: true, pay });
  };

  // "Finalizar venda": offline → fila directa; online → abre o ecrã de pagamento.
  const finalize = async () => {
    if (cart.length === 0 || emitting) return;
    if (!sync.online) {
      if (!isNativeApp()) {
        // NAVEGADOR: 100% online. A venda sem internet só existe na aplicação instalada.
        flashError('Sem ligação à internet. A Caixa no navegador precisa de rede — use a aplicação instalada para vender sem internet.');
        return;
      }
      // App sem rede: escolhe-se o pagamento como sempre (cartão, crédito, troco…);
      // a emissão cai na fila com esses dados — ver doEmit.
    }
    setEmitError(null);
    setShowPayment(true);
  };

  // Emissão real após escolher o método de pagamento (+ troco).
  const doEmit = async (pay: { paymentType: PaymentType; tendered?: number; changeGiven?: number; prescriptionRef?: string; payments?: { type: Exclude<PaymentType, 'CREDIT'>; amount: number }[] }) => {
    if (cart.length === 0 || emitting) return;
    setEmitting(true);
    setEmitError(null);
    // Chave desta venda, criada ANTES de tentar. Serve as duas saídas possíveis:
    // se a emissão online falhar por rede, a venda vai para a fila COM ESTA
    // MESMA chave — e o reenvio nunca cria um segundo documento fiscal.
    const clientOpId = newUuid();
    try {
      const invoice = await api.emitInvoice({
        docType: regCfg.defaultDocType,
        customerId: customer?.id,
        paymentType: pay.paymentType,
        tendered: pay.tendered,
        changeGiven: pay.changeGiven,
        ...(pay.prescriptionRef ? { prescriptionRef: pay.prescriptionRef } : {}),
        ...(pay.payments?.length ? { payments: pay.payments } : {}),
        ...(hasManual && discApproval ? { approvalPin: discApproval.pin } : {}),
        clientOpId,
        // Identidade do posto: é ela que decide a SÉRIE fiscal desta venda, e
        // com isso impede que duas caixas escrevam na mesma cadeia de hash.
        deviceKey: await deviceKey(),
        lines: cart.map((l) => {
          const rate = discountRateByProduct[l.product.id] ?? 0;
          return { productCode: l.product.code, quantity: l.quantity, ...(rate > 0 ? { discountRate: rate } : {}) };
        }),
      });
      setShowPayment(false);
      setEmitted({ invoice, customerName: receiptCustomer(customer), items: buildItems(cart), pay });
      void refreshProducts(); // stock atualiza em tempo real após a venda
      // Se esta venda saldou um pedido de balcão chamado da cozinha, fecha-o
      // (a emissão já baixou os ingredientes — aqui é só mudar o estado).
      if (recalledOrderIdRef.current) {
        const rid = recalledOrderIdRef.current;
        recalledOrderIdRef.current = null;
        void api.markKitchenOrderServed(rid).catch(() => undefined);
      }
    } catch (e) {
      if (isNativeApp() && e instanceof ApiError && e.status === 0) {
        // MESMA chave da tentativa online — ver finalizeOffline.
        try { await finalizeOffline(clientOpId, pay); setShowPayment(false); return; } catch { /* erro genérico */ }
      }
      setEmitError(e instanceof ApiError ? e.message : 'Não foi possível emitir o documento.');
    } finally {
      setEmitting(false);
    }
  };

  const closeReceipt = () => {
    setEmitted(null);
    setCart([]);
    setCartSel(new Set());
    setCustomer(null);
    void api.clearCartDraft().catch(marcarRascunhoVelho); // venda concluída → limpa o rascunho no servidor
  };

  // BALCÃO: envia o carrinho para a COZINHA (não vende ainda) e limpa o caixa.
  const fireToKitchen = async () => {
    if (cart.length === 0 || firing || emitting) return;
    setFiring(true);
    try {
      const items = cart.map((l) => ({ productCode: l.product.code, quantity: l.quantity }));
      const r = await api.fireToKitchen(items, customer?.name ?? undefined);
      setCart([]); setCartSel(new Set()); setCustomer(null);
      void api.clearCartDraft().catch(marcarRascunhoVelho);
      flashOk(`Enviado à cozinha: ${r.label}. Chame o pedido quando estiver pronto.`);
    } catch (e) { flashError(e instanceof ApiError ? e.message : 'Falha ao enviar para a cozinha.'); }
    finally { setFiring(false); }
  };

  // PRODUÇÃO: solicitar uma produção à cozinha (Ocupado/Esgotado). NÃO vende —
  // cria um pedido de balcão que flui ao KDS; o caixa chama-o quando pronto.
  const requestProduction = async (product: Product, quantity: number) => {
    try {
      const r = await api.fireToKitchen([{ productCode: product.code, quantity }], customer?.name ?? undefined);
      setProdPrompt(null);
      flashOk(`Produção solicitada: ${quantity}× ${product.name} (${r.label}). Chame quando estiver pronto.`);
      void refreshProducts();
    } catch (e) { flashError(e instanceof ApiError ? e.message : 'Falha ao solicitar produção.'); }
  };

  // Caixa CHAMA um pedido pronto da cozinha → carrega no carrinho para vender.
  const recallKitchenOrder = (order: { id: string; label: string; items: { productCode: string; quantity: string }[] }) => {
    const lines: CartLine[] = [];
    for (const it of order.items) {
      const p = products.find((x) => x.code === it.productCode);
      if (p) lines.push({ product: p, quantity: Math.max(1, Math.floor(Number(it.quantity)) || 1) });
    }
    if (lines.length === 0) { flashError('Os produtos deste pedido já não estão no catálogo.'); return; }
    setCart(lines);
    setCustomer(null);
    recalledOrderIdRef.current = order.id;
    setShowKitchen(false);
    flashOk(`Pedido de ${order.label} no caixa — finalize a venda.`);
  };

  return (
    <div className="app-bg">
      <div className="pos">
        {/* Barra de topo no padrão do POS de referência: ☰ + marca à esquerda;
            menus Autoconsumo / Caixa / Documentos e o operador à direita.
            Logótipo e nome são os do LPS Vendas / da empresa. */}
        <header className="topbar vtop">
          <img className="topbar-logo" src={identity?.logoUrl || LOGO_SRC} alt={identity?.companyName || SYSTEM_SHORT} onError={(e) => { (e.target as HTMLImageElement).src = LOGO_SRC; }} />
          <div className="who">
            <div className="name">{identity?.companyName || `${SYSTEM_SHORT} · Caixa`}</div>
          </div>
          <span className="spacer" />
          <SubscriptionRing />
          <nav className="vtop-menus" ref={topMenuRef}>
            <div className="vtop-m">
              <button className={topMenu === 'auto' ? 'on' : ''} onClick={() => setTopMenu((m) => (m === 'auto' ? null : 'auto'))} aria-expanded={topMenu === 'auto'}>Autoconsumo <Chev /></button>
              {topMenu === 'auto' ? (
                <div className="vtop-drop" role="menu">
                  <button role="menuitem" onClick={() => { setTopMenu(null); setShowConsumption(true); }}>Registar</button>
                </div>
              ) : null}
            </div>
            <div className="vtop-m">
              <button className={topMenu === 'caixa' ? 'on' : ''} onClick={() => setTopMenu((m) => (m === 'caixa' ? null : 'caixa'))} aria-expanded={topMenu === 'caixa'}>
                Caixa <span className={`vtop-dot ${session ? 'ok' : 'off'}`} aria-label={session ? 'Turno aberto' : 'Sem turno'} /> <Chev />
              </button>
              {topMenu === 'caixa' ? (
                <div className="vtop-drop" role="menu">
                  <div className="vtop-state">Estado da Caixa <b className={session ? 'ok' : 'off'}>{session ? 'Caixa Aberta' : 'Caixa Fechada'}</b></div>
                  <button role="menuitem" onClick={() => { setTopMenu(null); setShowShift(true); }}>{session ? 'Fechar Caixa' : 'Abrir Caixa'}<small>{session ? 'Contagem e fecho do turno' : 'Abrir turno para vender'}</small></button>
                  {session ? <button role="menuitem" onClick={() => { setTopMenu(null); setShowShift(true); }}>Entrada / Saída de dinheiro<small>Reforço ou sangria manual</small></button> : null}
                  {session ? <button role="menuitem" onClick={() => { setTopMenu(null); setShowShift(true); }}>Ponto de Caixa<small>Ponto de situação dos movimentos</small></button> : null}
                  {identity?.businessType === 'RESTAURANT' ? (
                    <button role="menuitem" onClick={() => { setTopMenu(null); setShowKitchen(true); }}>Cozinha{kitchenReady > 0 ? ` (${kitchenReady})` : ''}<small>Pedidos prontos do balcão</small></button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="vtop-m">
              <button className={topMenu === 'docs' ? 'on' : ''} onClick={() => setTopMenu((m) => (m === 'docs' ? null : 'docs'))} aria-expanded={topMenu === 'docs'}>Documentos <Chev /></button>
              {topMenu === 'docs' ? (
                <div className="vtop-drop" role="menu">
                  <button role="menuitem" onClick={() => { setTopMenu(null); setShowSales(true); }}>Faturação<small>Faturas, recibos e anulações</small></button>
                  {isNativeApp() && sync.pending > 0 ? (
                    <button role="menuitem" onClick={() => { setTopMenu(null); setShowQueue(true); }}>Por enviar ({sync.pending})<small>{sync.online ? 'A enviar sozinhas' : 'Sem rede — enviam quando houver ligação'}</small></button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </nav>
          {/* Sincronização automática e invisível; só aparece se o servidor RECUSAR algo. */}
          {isNativeApp() && !!sync.lastError && sync.pending > 0 ? (
            <button className={`conn ${sync.online ? 'on' : 'off'}`} onClick={() => setShowQueue(true)}
              title={sync.online ? 'Vendas guardadas no aparelho — enviam-se sozinhas' : 'Sem rede — envia sozinho quando houver ligação'}>
              {sync.online ? <IconCloud size={18} /> : <IconCloudOff size={18} />}
              <span className="conn-badge">{sync.pending}</span>
            </button>
          ) : null}
          <button className={`icon-btn${kbd.enabled ? ' on' : ''}`} onClick={kbd.toggle} title="Teclado no ecrã" aria-label="Teclado no ecrã">
            <IconKeyboard size={20} />
          </button>
          <ThemePicker />
          <OperatorMenu
            photo={operatorPhoto}
            name={user?.name || user?.email || 'Operador'}
            email={user?.storeName || user?.email || ''}
            role={user?.role ? ROLE_LABELS[user.role] ?? user.role : 'Equipa'}
            unread={chatUnread}
            custUnread={custUnread}
            canCustChat={canChatCustomers(user?.role)}
            onChat={() => setShowChat(true)}
            onCustChat={() => setShowCustChat(true)}
            onSelfConsumption={() => setShowConsumption(true)}
            onSalaryAdvance={() => setShowAdvance(true)}
            onLeave={() => setShowLeave(true)}
            onDocumento={() => setShowSales(true)}
            onLogout={logout}
          />
        </header>

        <div className="pos-body vpos">
          {/* Catálogo: separadores (pesquisa, todas as categorias, categorias) + grelha */}
          <section className="catalog vcat">
            <div className="vtabs" role="tablist" aria-label="Categorias">
              <button className={`vtab ic${showSearch ? ' on' : ''}`} onClick={() => setShowSearch((v) => !v)} aria-label="Pesquisar" aria-pressed={showSearch}><IconSearch size={18} /></button>
              <div className="vtab-wrap" ref={catMenuRef}>
                <button className={`vtab ic${catMenu ? ' on' : ''}`} onClick={() => setCatMenu((v) => !v)} aria-label="Todas as categorias" aria-expanded={catMenu}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="m8 10 4 4 4-4" fill="none" stroke="var(--vpos-tab, #0eaaa6)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {catMenu ? (
                  <div className="vtop-drop vcat-drop" role="menu">
                    <button role="menuitem" className={catFilter === '' ? 'on' : ''} onClick={() => { setCatFilter(''); setCatMenu(false); }}>Todos os produtos</button>
                    {catTabs.map((c) => (
                      <button role="menuitem" key={c.id} className={catFilter === c.id ? 'on' : ''} onClick={() => { setCatFilter(c.id); setCatMenu(false); }}>{c.name}</button>
                    ))}
                  </div>
                ) : null}
              </div>
              {catTabs.slice(0, 8).map((c) => (
                <button key={c.id} role="tab" aria-selected={catFilter === c.id} className={`vtab${catFilter === c.id ? ' sel' : ''}`} onClick={() => setCatFilter((f) => (f === c.id ? '' : c.id))}>{c.name}</button>
              ))}
            </div>

            <div className="vcat-body">
              {showSearch || search ? (
                <div className="search-bar vsearch">
                  <div style={{ flex: 1 }}>
                    <KeyboardInput
                      icon={<IconSearch size={18} />}
                      placeholder="Pesquisar por nome, código ou código de barras"
                      value={search}
                      onChange={setSearch}
                      onSubmit={onSearchEnter}
                    />
                  </div>
                  <BarcodeScanner continuous onDetected={(code) => scanResolve(code)} />
                  <button className="icon-btn" title="Atualizar produtos" aria-label="Atualizar produtos" onClick={() => void refreshProducts()}>
                    <IconSync size={20} />
                  </button>
                </div>
              ) : null}

              {loading ? (
                <div className="empty"><div className="vproc vproc-sm" style={{ color: 'var(--muted)', textShadow: 'none' }}><div className="vproc-ring"><img src={LOGO_ROUND} alt="" /><i /><b /></div><span>A sincronizar produtos…</span></div></div>
              ) : error ? (
                <div className="empty"><div className="banner danger">{error}</div></div>
              ) : shown.length === 0 ? (
                <div className="empty">
                  <IconCube size={40} />
                  <div>{search ? 'Nenhum produto encontrado.' : catFilter ? 'Sem produtos nesta categoria.' : 'Sem produtos activos.'}</div>
                </div>
              ) : (
                <div className="vgrid">
                  {shown.map((p, i) => {
                    const stock = Number(p.stock_qty);
                    const madeToOrder = !!p.has_recipe;
                    const out = !madeToOrder && stock <= 0;
                    return (
                      <button key={p.id} className={`vtile${out ? ' out' : ''}${p.image_url ? ' img' : ''}`} onClick={() => addToCart(p)} title={`${p.name} · ${p.code}${madeToOrder ? '' : ` · ${out ? 'Esgotado' : `${formatNumber(stock)} em stock`}`}`}
                        style={{ animationDelay: `${Math.min(i, 24) * 12}ms` }}>
                        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : null}
                        <span className="vt-name">{p.name}</span>
                        {regCfg.showReference ? <span className="vt-ref">{p.code}</span> : null}
                        <span className="vt-price">{formatKz(regCfg.pricesWithTax ? grossUnit(p) : Number(p.unit_price))}</span>
                        {out ? <span className="vt-flag">Esgotado</span> : stock > 0 && stock <= 5 && !madeToOrder ? <span className="vt-flag low">{formatNumber(stock)}</span> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Venda: navegação entre vendas, tabela, total, Opções e FINALIZAR */}
          <aside className="cart vcart">
            <div className="vsale-nav">
              <button onClick={() => parked.length && resumeParked(parked[parked.length - 1].id)} disabled={parked.length === 0} aria-label="Venda anterior">‹</button>
              <span>Venda (<b>{parked.length + 1}/{parked.length + 1}</b>)</span>
              <button onClick={() => parked.length && resumeParked(parked[0].id)} disabled={parked.length === 0} aria-label="Venda seguinte">›</button>
            </div>

            <div className="vcart-box">
              {optsOpen ? (
                <div className="vopts" role="menu">
                  <button role="menuitem" onClick={() => { setOptsOpen(false); setShowCustomer(true); }}><IconUser size={18} /> {customer ? `Cliente: ${customer.name}` : 'Cliente'}</button>
                  <button role="menuitem" onClick={() => { setOptsOpen(false); parkCurrent(); }} disabled={cart.length === 0}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg> Nova Venda
                  </button>
                  {parked.length > 0 ? (
                    <button role="menuitem" onClick={() => { setOptsOpen(false); setShowParked(true); }}><IconReceipt size={18} /> Vendas suspensas ({parked.length})</button>
                  ) : null}
                  {identity?.businessType === 'RESTAURANT' && session && sync.online ? (
                    <button role="menuitem" onClick={() => { setOptsOpen(false); void fireToKitchen(); }} disabled={cart.length === 0 || firing || emitting}><IconReceipt size={18} /> {firing ? 'A enviar…' : 'Enviar para cozinha'}</button>
                  ) : null}
                  {!session && sync.online ? (
                    <button role="menuitem" onClick={() => { setOptsOpen(false); setShowShift(true); }}><IconReceipt size={18} /> Abrir Caixa</button>
                  ) : null}
                  <button role="menuitem" onClick={() => { if (confirmCancel) { setCart([]); setCartSel(new Set()); setCustomer(null); setConfirmCancel(false); setOptsOpen(false); } else setConfirmCancel(true); }} disabled={cart.length === 0}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg> {confirmCancel ? 'Confirmar: cancelar venda' : 'Cancelar Venda'}
                  </button>
                </div>
              ) : (
                <>
                  {showParked && parked.length > 0 ? (
                    <div className="parked-list" role="list">
                      {parked.map((s) => {
                        const t = cartTotals(s.lines);
                        const cli = s.customerId ? customers.find((c) => c.id === s.customerId)?.name : null;
                        return (
                          <div className="parked-item" role="listitem" key={s.id}>
                            <div className="parked-info">
                              <strong>{formatKz(t.gross)}</strong>
                              <span className="muted">{formatNumber(t.count)} un · {new Date(s.parkedAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}{cli ? ` · ${cli}` : ''}</span>
                            </div>
                            <button className="btn sm" onClick={() => resumeParked(s.id)}>Retomar</button>
                            <button className="btn sm ghost" onClick={() => discardParkedSale(s.id)}>{confirmDiscard === s.id ? 'Confirmar descarte' : 'Descartar'}</button>
                          </div>
                        );
                      })}
                      <button className="btn sm ghost block" onClick={() => setShowParked(false)}>Fechar</button>
                    </div>
                  ) : null}
                  <div className="vtable-h"><span>Produto</span><span>Qtd</span><span>Preço</span><span /></div>
                  {cart.length === 0 ? (
                    <div className="vtable-empty">Para começar a faturar, adicione produtos à venda.</div>
                  ) : (
                    <div className="vtable-b cart-lines">
                      {cart.map((l) => {
                        const rate = discountRateByProduct[l.product.id] ?? 0;
                        const gross = lineGross(l);
                        const open = openLine === l.product.id;
                        return (
                          <div className={`vline${open ? ' open' : ''}`} key={l.product.id}>
                            <button className="vline-main" onClick={() => setOpenLine(open ? null : l.product.id)} aria-expanded={open}>
                              <span className="vl-name">{l.product.name}{promoByProduct[l.product.id]?.name ? <small>{promoByProduct[l.product.id].name}</small> : null}</span>
                              <span className="vl-qty">{formatNumber(l.quantity)}</span>
                              <span className="vl-price">
                                {rate > 0 ? <><s>{formatKz(gross)}</s>{formatKz(Math.round(gross * (1 - rate) * 100) / 100)}</> : formatKz(gross)}
                              </span>
                            </button>
                            <button className="vl-del" onClick={() => removeLine(l.product.id)} aria-label={`Remover ${l.product.name}`}>✕</button>
                            {open ? (
                              <div className="vline-ctl">
                                <div className="stepper">
                                  <button onClick={() => changeQty(l.product.id, -1)} aria-label="Menos"><IconMinus size={16} /></button>
                                  <span className="qty">{l.quantity}</span>
                                  <button onClick={() => changeQty(l.product.id, +1)} aria-label="Mais"><IconPlus size={16} /></button>
                                </div>
                                <span className="muted" style={{ fontSize: 12 }}>{formatKz(grossUnit(l.product))} · {l.product.iva_code}</span>
                                <button className="btn sm ghost" onClick={() => setDiscLine(l)}>
                                  {(manualDisc[l.product.id] ?? 0) > 0 ? `−${(Math.round((manualDisc[l.product.id] ?? 0) * 1000) / 10).toLocaleString('pt-PT')} %` : '% Desconto'}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {customer ? (
                    <button className="vcust" onClick={() => setShowCustomer(true)}><IconUser size={16} /> {customer.name}</button>
                  ) : null}
                </>
              )}
            </div>

            {emitError ? <div className="banner danger">{emitError}</div> : null}
            {cartStorageWarn ? <div className="banner danger">Não foi possível guardar o carrinho neste aparelho. Conclua a venda antes de fechar a aplicação.</div> : null}
            {okMsg ? <div className="banner" style={{ background: 'color-mix(in srgb, var(--success, #30a46c) 16%, transparent)', color: 'var(--success, #1a7f4b)', fontWeight: 700 }}>{okMsg}</div> : null}

            <div className="vtotal">
              <span>TOTAL</span>
              <div>
                <b>{formatKz(totals.gross)}</b>
                <small>{cart.length} Produtos / {formatNumber(totals.count)} Uni.{totals.discount > 0 ? ` · −${formatKz(totals.discount)}` : ''}</small>
              </div>
            </div>
            <div className="vactions">
              <button className={`vopt-btn${optsOpen ? ' on' : ''}`} onClick={() => { setOptsOpen((v) => !v); setConfirmCancel(false); }} aria-expanded={optsOpen}>
                <span className="car" aria-hidden="true">{optsOpen ? '⌄' : '⌃'}</span> Opções
              </button>
              {!optsOpen ? (
                !session && sync.online ? (
                  <button className="vfinal" onClick={() => setShowShift(true)}>ABRIR CAIXA</button>
                ) : (
                  <button className="vfinal" onClick={finalize} disabled={cart.length === 0 || emitting}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                    {emitting ? 'A EMITIR…' : sync.online ? 'FINALIZAR' : 'GUARDAR'}
                  </button>
                )
              ) : null}
            </div>
          </aside>
        </div>
        <footer className="pos-footer">
          <FooterCredit compact />
        </footer>
      </div>

      {discLine ? (
        <DiscountModal
          name={discLine.product.name}
          lineGross={lineGross(discLine)}
          current={manualDisc[discLine.product.id] ?? 0}
          promoRate={promoByProduct[discLine.product.id]?.discountRate ?? 0}
          role={user?.role}
          approvedBy={discApproval?.name ?? null}
          onApply={(rate, approval) => {
            const id = discLine.product.id;
            setManualDisc((m) => { const n = { ...m }; if (rate > 0) n[id] = rate; else delete n[id]; return n; });
            if (approval) setDiscApproval(approval);
            setDiscLine(null);
          }}
          onClose={() => setDiscLine(null)}
        />
      ) : null}

      {showCustomer ? (
        <CustomerModal
          customers={customers}
          onPick={(c) => {
            setCustomer(c);
            setShowCustomer(false);
          }}
          onCreated={(c) => {
            setCustomers((prev) => [c, ...prev]);
            setCustomer(c);
            setShowCustomer(false);
          }}
          onClose={() => setShowCustomer(false)}
        />
      ) : null}

      {emitted ? (
        <ReceiptModal
          invoice={emitted.invoice}
          info={receiptInfo}
          identity={identity}
          customerName={emitted.customerName}
          operatorName={user?.name || user?.email}
          items={emitted.items}
          provisional={emitted.provisional}
          pay={emitted.pay}
          onClose={closeReceipt}
        />
      ) : null}

      {showQueue ? <QueueModal onClose={() => setShowQueue(false)} /> : null}
      {showKitchen ? <KitchenOrdersModal onClose={() => { setShowKitchen(false); void pollKitchenReady(); }} onRecall={recallKitchenOrder} /> : null}
      {prodPrompt ? <ProductionPrompt prompt={prodPrompt} onClose={() => setProdPrompt(null)} onConfirm={requestProduction} /> : null}

      {showSales ? (
        <SalesHistoryModal
          canCancel={canCancel}
          onClose={() => setShowSales(false)}
          onChanged={() => { api.listProducts().then(setProducts).catch(() => undefined); }}
        />
      ) : null}

      {showShift ? (
        <ShiftModal
          session={session}
          cartCount={cart.length}
          identity={identity}
          operatorName={user?.name || user?.email}
          onOpened={async () => {
            setShowShift(false);
            // SEM REDE o turno foi aberto NESTE aparelho: usar esse (antes ficava
            // null e a Caixa voltava a pedir para abrir turno, em ciclo).
            const s = await api.currentSession().catch(() => undefined);
            if (s !== undefined) { setSession(s); void espelharTurnoServidor(s); return; }
            const t = await turnoAbertoLocal();
            setSession(t ? {
              id: t.opId, register_code: t.registerCode, opened_by_name: t.operatorName,
              opened_at: t.openedAt, opening_float: String(t.openingFloat), status: 'OPEN',
            } : null);
          }}
          onClosed={async () => { setShowShift(false); setSession(null); void espelharTurnoServidor(null); }}
          onClose={() => setShowShift(false)}
        />
      ) : null}

      {showChat ? (
        <ChatModal meId={user?.sub} onClose={() => setShowChat(false)} onRead={() => setChatUnread(0)} />
      ) : null}

      {showCustChat && custChatAllowed ? (
        <CustomerChatModal onClose={() => setShowCustChat(false)} onRead={() => setCustUnread(0)} />
      ) : null}

      {showConsumption ? (
        <SelfConsumptionModal products={products} onClose={() => setShowConsumption(false)} />
      ) : null}
      {showLeave ? <LeaveRequestModal onClose={() => setShowLeave(false)} /> : null}
      {showAdvance ? (
        <SalaryAdvanceModal onClose={() => setShowAdvance(false)} />
      ) : null}
      <IdleLock
        photo={operatorPhoto}
        name={user?.name || user?.email || 'Operador'}
        role={user?.role ? ROLE_LABELS[user.role] ?? user.role : 'Equipa'}
      />

      {emitting ? (
        <div className="vproc-bg" role="status" aria-live="polite"><div className="vproc"><div className="vproc-ring"><img src={LOGO_ROUND} alt="" /><i /><b /></div><span>A processar documento…</span></div></div>
      ) : null}

      {showPayment ? (
        <PaymentModal
          total={totals.gross}
          customerName={customer?.name ?? null}
          prescriptionItems={cart.filter((l) => l.product.requires_prescription).map((l) => l.product.name)}
          lines={cart.map((l) => ({ name: l.product.name, qty: l.quantity, gross: lineGross(l) }))}
          onEditCustomer={() => setShowCustomer(true)}
          busy={emitting}
          onConfirm={doEmit}
          onClose={() => setShowPayment(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Prompt de PRODUÇÃO no caixa: o produto de produção não está Livre.
 * Ocupado → "está em produção; criar mais?"; Esgotado → "indisponível; solicitar?".
 * Nunca vende de imediato — ao confirmar, cria um pedido de produção (à cozinha).
 */
function ProductionPrompt({
  prompt, onClose, onConfirm,
}: {
  prompt: { product: Product; status: 'BUSY' | 'OUT' };
  onClose(): void;
  onConfirm(product: Product, quantity: number): void | Promise<void>;
}) {
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const busyState = prompt.status === 'BUSY';
  const confirm = async () => {
    const n = Math.max(1, Math.floor(Number(qty)) || 1);
    setBusy(true);
    try { await onConfirm(prompt.product, n); } finally { setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 6px' }}>{busyState ? 'Em produção' : 'Indisponível'}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {busyState
            ? <>«{prompt.product.name}» está em produção. Pretende criar mais uma produção?</>
            : <>«{prompt.product.name}» está esgotado. Pretende solicitar produção?</>}
        </p>
        <div className="field">
          <label>Quantidade a produzir</label>
          <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} autoFocus />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn ghost lg" style={{ flex: 1 }} onClick={onClose} disabled={busy}>Não</button>
          <button className="btn lg" style={{ flex: 1 }} onClick={() => void confirm()} disabled={busy}>
            {busy ? 'A solicitar…' : 'Sim, solicitar'}
          </button>
        </div>
      </div>
    </div>
  );
}

const Chev = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
