import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CashSession, Customer, DocumentIdentity, EmittedInvoice, PaymentType, Product, ReceiptFiscalInfo } from '../api/types';
import { IVA_RATE } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LOGO_SRC, SYSTEM_SHORT } from '../brand';
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
import { BarcodeScanner } from '../components/BarcodeScanner';
import { SalesHistoryModal } from '../components/SalesHistoryModal';
import { QueueModal } from '../components/QueueModal';
import { ShiftModal } from '../components/ShiftModal';
import { ChatModal } from '../components/ChatModal';
import { ThemePicker } from '../components/ThemePicker';
import { PaymentModal } from '../components/PaymentModal';
import { IconReceipt } from '../components/Icons';
import { cartTotals, cartTotalsWithDiscount, lineGross, type CartLine } from '../pos/cart';
import { bestPromoForLine, type PromoRow } from '../pos/promo';
import { useBarcodeScanner } from '../pos/useBarcodeScanner';
import { formatKz, formatNumber } from '../format';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { useKeyboard } from '../keyboard/KeyboardProvider';
import { buildPendingSale, kvGet, kvSet, queueSale } from '../offline/db';
import { syncController } from '../offline/sync';
import { useSync } from '../offline/useSync';

const CACHE_PRODUCTS = 'cache:products';

const ROLE_LABELS: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador',
  STORE_MANAGER: 'Gestor de loja',
  SHIFT_SUPERVISOR: 'Supervisor',
  CASHIER: 'Operador de caixa',
  ATTENDANT: 'Atendedor',
};

function grossUnit(p: Product): number {
  return Number(p.unit_price) * (1 + IVA_RATE[p.iva_code] / 100);
}

/** Menu do operador (canto superior direito): avatar + seta → nome, email e
 *  terminar sessão. Fecha ao clicar fora. */
function OperatorMenu({ photo, name, email, role, unread, onChat, onLogout }: {
  photo: string | null; name: string; email: string; role: string; unread: number; onChat(): void; onLogout(): void;
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
    <div ref={ref} className="op-menu">
      <button className="op-menu-btn" onClick={() => setOpen((v) => !v)} title={name} aria-label="Conta do operador">
        {photo ? <img className="op-avatar" src={photo} alt={name} />
          : <span className="op-avatar op-avatar-ph"><IconUser size={18} /></span>}
        {unread > 0 ? <span className="op-badge">{unread > 99 ? '99+' : unread}</span> : null}
        <span className={`op-caret${open ? ' up' : ''}`}>▾</span>
      </button>
      {open ? (
        <div className="op-menu-pop">
          <div className="op-menu-head">
            {photo ? <img className="op-avatar lg" src={photo} alt={name} />
              : <span className="op-avatar lg op-avatar-ph"><IconUser size={22} /></span>}
            <div style={{ minWidth: 0 }}>
              <div className="op-menu-name">{name}</div>
              {email ? <div className="op-menu-email">{email}</div> : null}
              <div className="op-menu-role">{role}</div>
            </div>
          </div>
          <button className="op-menu-item" onClick={() => { setOpen(false); onChat(); }}>
            <span style={{ fontSize: 16, width: 17, display: 'inline-grid', placeItems: 'center' }}>💬</span> Chat com gerente
            {unread > 0 ? <span className="op-item-badge">{unread > 99 ? '99+' : unread}</span> : null}
          </button>
          <button className="op-menu-item danger" onClick={() => { setOpen(false); onLogout(); }}>
            <IconLogout size={17} /> Terminar sessão
          </button>
        </div>
      ) : null}
    </div>
  );
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
    api.operators(companyCode)
      .then((r) => { if (alive) setOperatorPhoto(r.operators.find((o) => o.id === user.sub)?.photo_url ?? null); })
      .catch(() => { /* sem rede → ícone */ });
    return () => { alive = false; };
  }, [companyCode, user?.sub]);

  const [products, setProducts] = useState<Product[]>([]);
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
  const [cart, setCart] = useState<CartLine[]>(() => {
    try { const raw = cartKey ? localStorage.getItem(cartKey) : null; return raw ? (JSON.parse(raw) as CartLine[]) : []; }
    catch { return []; }
  });
  const [cartSel, setCartSel] = useState<Set<string>>(new Set());
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSales, setShowSales] = useState(false);

  // Turno de caixa
  const [session, setSession] = useState<CashSession | null>(null);
  const [showShift, setShowShift] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  // Chat de equipa (caixa ↔ gerente): badge de não-lidas + janela.
  const [showChat, setShowChat] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = () => { api.chatUnread().then((r) => { if (alive) setChatUnread(r.count); }).catch(() => undefined); };
    tick();
    const t = window.setInterval(tick, 10000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const [emitting, setEmitting] = useState(false);
  const [emitError, setEmitError] = useState<string | null>(null);
  const [emitted, setEmitted] = useState<
    { invoice: EmittedInvoice; customerName: string | null; items?: { description: string; quantity: number; unitPrice: number; total: number }[]; provisional?: boolean } | null
  >(null);

  // Constrói as linhas de artigos (descrição, qt, preço unit. c/IVA, total) para a fatura.
  const buildItems = (lines: CartLine[]) => lines.map((l) => {
    const total = lineGross(l);
    return { description: l.product.name, quantity: l.quantity, unitPrice: l.quantity ? Math.round((total / l.quantity) * 100) / 100 : total, total };
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
      // Best-effort (não bloqueiam a caixa).
      api.listCustomers().then(setCustomers).catch(() => undefined);
      api.receiptInfo().then(setReceiptInfo).catch(() => undefined);
      api.documentIdentity().then(setIdentity).catch(() => undefined);
      api.currentSession().then(setSession).catch(() => undefined);
      api.listPromotions().then(setPromotions).catch(() => undefined);
    })();
  }, []);

  // Atualização em TEMPO REAL do stock/catálogo: refaz a lista do servidor
  // (após cada venda/cancelamento e periodicamente), sem o utilizador recarregar.
  const refreshProducts = useCallback(async () => {
    try {
      const list = await api.listProducts();
      setProducts(list);
      void kvSet(CACHE_PRODUCTS, list);
    } catch { /* offline: mantém a cache */ }
  }, []);

  useEffect(() => {
    if (!sync.online) return;
    const t = window.setInterval(() => { void refreshProducts(); }, 12000);
    // Atualiza também ao voltar ao separador / ganhar foco (catálogo sempre fresco).
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q),
    );
  }, [products, search]);

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

  const discountRateByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const id in promoByProduct) m[id] = promoByProduct[id].discountRate;
    return m;
  }, [promoByProduct]);

  const totals = cartTotalsWithDiscount(cart, discountRateByProduct);

  const flashError = (m: string) => { setEmitError(m); setTimeout(() => setEmitError(null), 2500); };

  /** Lança o produto no carrinho. Devolve `true` SÓ se foi realmente lançado
   *  (não esgotado / com stock) — para o campo de pesquisa só limpar nesse caso. */
  const addToCart = (p: Product): boolean => {
    setEmitError(null);
    const stock = Number(p.stock_qty);
    if (stock <= 0) { flashError(`"${p.name}" está esgotado.`); return false; }
    const current = cart.find((l) => l.product.id === p.id)?.quantity ?? 0;
    if (current + 1 > stock) { flashError(`Stock insuficiente de "${p.name}": só há ${stock}.`); return false; }
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
          if (delta > 0 && next > stock) { flashError(`Stock insuficiente de "${l.product.name}": só há ${stock}.`); return l; }
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

  // Persiste o carrinho do operador (ou limpa a chave quando esvazia).
  useEffect(() => {
    if (!cartKey) return;
    try {
      if (cart.length) localStorage.setItem(cartKey, JSON.stringify(cart));
      else localStorage.removeItem(cartKey);
    } catch { /* storage cheio/indisponível — ignora */ }
  }, [cart, cartKey]);

  // Reconcilia o carrinho com o STOCK ATUAL (ex.: outro caixa vendeu entretanto):
  // remove o que esgotou/saiu do catálogo e ajusta quantidades ao disponível.
  useEffect(() => {
    if (products.length === 0) return;
    setCart((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const out: CartLine[] = [];
      for (const l of prev) {
        const fresh = products.find((p) => p.id === l.product.id);
        if (!fresh) { changed = true; continue; }
        const stock = Number(fresh.stock_qty);
        if (stock <= 0) { changed = true; continue; }
        const qty = Math.min(l.quantity, stock);
        if (qty !== l.quantity || fresh !== l.product) changed = true;
        out.push({ product: fresh, quantity: qty });
      }
      // Ajuste SILENCIOSO ao stock atual (o utilizador não precisa de ver o aviso).
      return changed ? out : prev;
    });
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
        const draft = await api.getCartDraft();
        if (draft && Array.isArray(draft.lines) && draft.lines.length) {
          const lines: CartLine[] = [];
          for (const d of draft.lines) {
            const p = products.find((x) => x.id === d.productId);
            if (!p) continue;
            const stock = Number(p.stock_qty);
            if (stock <= 0) continue;
            lines.push({ product: p, quantity: Math.min(d.quantity, stock) });
          }
          if (lines.length) setCart(lines);
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
      if (cart.length === 0) void api.clearCartDraft().catch(() => undefined);
      else void api.saveCartDraft(cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })), customer?.id ?? null).catch(() => undefined);
    }, 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [cart, customer, sync.online]);

  /**
   * Resolve um código lido (leitor físico, câmara ou Enter na pesquisa):
   * procura por código de barras / código EXACTO; lança ao carrinho e LIMPA a
   * pesquisa (auto-enter), pronto para a próxima leitura.
   */
  const scanResolve = (raw: string): boolean => {
    const code = raw.trim();
    if (!code) return false;
    const found = products.find(
      (p) => (p.barcode && p.barcode === code) || p.code.toLowerCase() === code.toLowerCase(),
    );
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
    flashError('Vários resultados — toque no produto ou leia o código.');
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
      const exact = products.find((p) => (p.barcode && p.barcode === q) || p.code.toLowerCase() === q.toLowerCase());
      if (exact && addToCart(exact)) setSearch('');
    }, 140);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, products]);

  /** Guarda a venda na fila offline e mostra um comprovativo PROVISÓRIO. */
  const finalizeOffline = async () => {
    const sale = buildPendingSale(cart, totals, customer ? { id: customer.id, name: customer.name } : null);
    await queueSale(sale);
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
    setEmitted({ invoice: provisionalInvoice, customerName: customer?.name ?? null, items: buildItems(cart), provisional: true });
  };

  // "Finalizar venda": offline → fila directa; online → abre o ecrã de pagamento.
  const finalize = async () => {
    if (cart.length === 0 || emitting) return;
    if (!sync.online) {
      setEmitting(true);
      try { await finalizeOffline(); } finally { setEmitting(false); }
      return;
    }
    setEmitError(null);
    setShowPayment(true);
  };

  // Emissão real após escolher o método de pagamento (+ troco).
  const doEmit = async (pay: { paymentType: PaymentType; tendered?: number; changeGiven?: number }) => {
    if (cart.length === 0 || emitting) return;
    setEmitting(true);
    setEmitError(null);
    try {
      const invoice = await api.emitInvoice({
        customerId: customer?.id,
        paymentType: pay.paymentType,
        tendered: pay.tendered,
        changeGiven: pay.changeGiven,
        lines: cart.map((l) => {
          const rate = discountRateByProduct[l.product.id] ?? 0;
          return { productCode: l.product.code, quantity: l.quantity, ...(rate > 0 ? { discountRate: rate } : {}) };
        }),
      });
      setShowPayment(false);
      setEmitted({ invoice, customerName: customer?.name ?? null, items: buildItems(cart) });
      void refreshProducts(); // stock atualiza em tempo real após a venda
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        try { await finalizeOffline(); setShowPayment(false); return; } catch { /* erro genérico */ }
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
    void api.clearCartDraft().catch(() => undefined); // venda concluída → limpa o rascunho no servidor
  };

  return (
    <div className="app-bg">
      <div className="pos">
        <header className="topbar">
          <img className="topbar-logo" src={identity?.logoUrl || LOGO_SRC} alt={identity?.companyName || SYSTEM_SHORT} onError={(e) => { (e.target as HTMLImageElement).src = LOGO_SRC; }} />
          <div className="who">
            <div className="name">{identity?.companyName || `${SYSTEM_SHORT} · Caixa`}</div>
            {user?.storeName ? <div className="store-tag">🏪 {user.storeName}</div> : null}
          </div>
          <span className="spacer" />
          <button
            className={`conn ${session ? 'on' : 'off'}`}
            onClick={() => setShowShift(true)}
            title={session ? 'Turno aberto — clique para fechar' : 'Sem turno — clique para abrir'}
          >
            <IconReceipt size={18} />
            <span className="conn-label">{session ? 'Turno aberto' : 'Abrir turno'}</span>
          </button>
          <button className="conn" onClick={() => setShowSales(true)} title="Histórico de vendas / cancelar">
            <IconCart size={18} />
            <span className="conn-label">Vendas</span>
          </button>
          <button
            className={`conn ${sync.online ? 'on' : 'off'}`}
            onClick={() => {
              if (sync.online && sync.pending > 0) sync.flush();
              setShowQueue(true);
            }}
            title={sync.online ? 'Online — ver fila de vendas' : 'Offline — vendas guardadas localmente'}
          >
            {sync.syncing ? (
              <IconSync size={18} className="spin" />
            ) : sync.online ? (
              <IconCloud size={18} />
            ) : (
              <IconCloudOff size={18} />
            )}
            <span className="conn-label">{sync.online ? 'Online' : 'Offline'}</span>
            {sync.pending > 0 ? <span className="conn-badge">{sync.pending}</span> : null}
          </button>
          <button
            className={`icon-btn${kbd.enabled ? ' on' : ''}`}
            onClick={kbd.toggle}
            title="Teclado no ecrã"
          >
            <IconKeyboard size={22} />
          </button>
          <ThemePicker />
          <OperatorMenu
            photo={operatorPhoto}
            name={user?.name || user?.email || 'Operador'}
            email={user?.email || ''}
            role={user?.role ? ROLE_LABELS[user.role] ?? user.role : 'Equipa'}
            unread={chatUnread}
            onChat={() => setShowChat(true)}
            onLogout={logout}
          />
        </header>

        <div className="pos-body">
          {/* Catálogo */}
          <section className="catalog">
            <div className="search-bar">
              <div style={{ flex: 1 }}>
                <KeyboardInput
                  icon={<IconSearch size={18} />}
                  placeholder="Procurar produto por nome, código ou código de barras…"
                  value={search}
                  onChange={setSearch}
                  onSubmit={onSearchEnter}
                />
              </div>
              <BarcodeScanner continuous onDetected={(code) => scanResolve(code)} />
              <button className="icon-btn" title="Atualizar produtos" onClick={() => void refreshProducts()}>
                <IconSync size={20} />
              </button>
            </div>

            {loading ? (
              <div className="empty">A carregar produtos…</div>
            ) : error ? (
              <div className="empty">
                <div className="banner danger">{error}</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty">
                <IconCube size={40} />
                <div>{search ? 'Nenhum produto encontrado.' : 'Sem produtos activos.'}</div>
              </div>
            ) : (
              <div className="grid">
                {filtered.map((p) => {
                  const stock = Number(p.stock_qty);
                  const out = stock <= 0;
                  return (
                    <button key={p.id} className={`prod${out ? ' out' : ''}`} onClick={() => addToCart(p)}>
                      <div>
                        <div className="pname">{p.name}</div>
                        <div className="pcode">{p.code}</div>
                      </div>
                      <div className="pstock">
                        {out
                          ? <span className="stock-out">Esgotado</span>
                          : <span className={`stock-ok${stock <= 5 ? ' low' : ''}`}>{formatNumber(stock)} em stock</span>}
                      </div>
                      <div className="pfoot">
                        <span className="pprice">{formatKz(grossUnit(p))}</span>
                        <span className="iva-badge">{p.iva_code}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Carrinho */}
          <aside className="cart">
            <h2>
              <IconCart size={20} /> Carrinho{' '}
              {totals.count > 0 ? <span className="muted">· {formatNumber(totals.count)} un</span> : null}
            </h2>

            {cart.length === 0 ? (
              <div className="empty">
                <IconCart size={40} />
                <div>Carrinho vazio</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Toque num produto para adicionar.
                </div>
              </div>
            ) : (
              <div className="cart-lines">
                {/* Barra de seleção só aparece DEPOIS de marcar ≥1 produto —
                    não estraga a estética do carrinho ao lançar. */}
                {cartSel.size > 0 ? (
                  <div className="row" style={{ gap: 8, alignItems: 'center', padding: '0 2px 6px' }}>
                    <label className="row" style={{ gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={allCartSel} onChange={toggleAllCart} aria-label="Selecionar tudo" />
                      Selecionar tudo
                    </label>
                    <span className="spacer" style={{ flex: 1 }} />
                    <button className="btn sm ghost" onClick={clearCart}>Limpar ({cartSel.size})</button>
                  </div>
                ) : null}
                {cart.map((l) => (
                  <div className="cart-line" key={l.product.id}>
                    <div className="cl-top">
                      <input type="checkbox" style={{ marginRight: 8 }} checked={cartSel.has(l.product.id)} onChange={() => toggleCartSel(l.product.id)} aria-label={`Selecionar ${l.product.name}`} />
                      <div>
                        <div className="cl-name">{l.product.name}</div>
                        <div className="cl-sub">
                          {formatKz(grossUnit(l.product))} · {l.product.iva_code}
                        </div>
                      </div>
                      <button className="trash" onClick={() => removeLine(l.product.id)} aria-label="Remover">
                        <IconTrash size={18} />
                      </button>
                    </div>
                    <div className="cl-bottom">
                      <div className="stepper">
                        <button onClick={() => changeQty(l.product.id, -1)} aria-label="Menos">
                          <IconMinus size={18} />
                        </button>
                        <span className="qty">{l.quantity}</span>
                        <button onClick={() => changeQty(l.product.id, +1)} aria-label="Mais">
                          <IconPlus size={18} />
                        </button>
                      </div>
                      {(() => {
                        const promo = promoByProduct[l.product.id];
                        const gross = lineGross(l);
                        if (promo && promo.discount > 0) {
                          return (
                            <span className="cl-total" style={{ textAlign: 'right' }}>
                              <span style={{ textDecoration: 'line-through', color: 'var(--muted)', fontWeight: 600, fontSize: 12, display: 'block' }}>{formatKz(gross)}</span>
                              <span style={{ color: 'var(--success)' }}>{formatKz(gross - promo.discount)}</span>
                            </span>
                          );
                        }
                        return <span className="cl-total">{formatKz(gross)}</span>;
                      })()}
                    </div>
                    {promoByProduct[l.product.id]?.name ? (
                      <div className="cl-promo">🏷️ {promoByProduct[l.product.id].name}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="cart-foot">
              <button className="btn ghost block" onClick={() => setShowCustomer(true)}>
                <IconUser size={18} /> {customer ? customer.name : 'Consumidor final'}
              </button>

              {emitError ? <div className="banner danger">{emitError}</div> : null}

              <div className="totals">
                <div className="t-row">
                  <span>Base tributável</span>
                  <span>{formatKz(totals.net)}</span>
                </div>
                <div className="t-row">
                  <span>IVA</span>
                  <span>{formatKz(totals.iva)}</span>
                </div>
                {totals.discount > 0 ? (
                  <div className="t-row" style={{ color: 'var(--success)' }}>
                    <span>🏷️ Desconto promoções</span>
                    <span>−{formatKz(totals.discount)}</span>
                  </div>
                ) : null}
                <div className="t-row grand">
                  <span>Total</span>
                  <span>{formatKz(totals.gross)}</span>
                </div>
              </div>

              {!session && sync.online ? (
                <button className="btn lg block" onClick={() => setShowShift(true)}>
                  <IconReceipt size={18} /> Abrir turno para vender
                </button>
              ) : (
                <button
                  className="btn success lg block"
                  onClick={finalize}
                  disabled={cart.length === 0 || emitting}
                >
                  {emitting
                    ? 'A emitir…'
                    : sync.online
                      ? 'Finalizar venda'
                      : 'Guardar venda (offline)'}
                </button>
              )}
            </div>
          </aside>
        </div>
        <footer className="pos-footer">
          <FooterCredit compact />
        </footer>
      </div>

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
          onClose={closeReceipt}
        />
      ) : null}

      {showQueue ? <QueueModal onClose={() => setShowQueue(false)} /> : null}

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
          onOpened={async () => { setShowShift(false); setSession(await api.currentSession().catch(() => null)); }}
          onClosed={async () => { setShowShift(false); setSession(null); }}
          onClose={() => setShowShift(false)}
        />
      ) : null}

      {showChat ? (
        <ChatModal meId={user?.sub} onClose={() => setShowChat(false)} onRead={() => setChatUnread(0)} />
      ) : null}

      {showPayment ? (
        <PaymentModal
          total={totals.gross}
          customerName={customer?.name ?? null}
          busy={emitting}
          onConfirm={doEmit}
          onClose={() => setShowPayment(false)}
        />
      ) : null}
    </div>
  );
}
