import React, { useEffect, useMemo, useState } from 'react';
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
import { QueueModal } from '../components/QueueModal';
import { ShiftModal } from '../components/ShiftModal';
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

export function PosPage() {
  const { user, logout } = useAuth();
  const kbd = useKeyboard();
  const sync = useSync();

  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<PromoRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [receiptInfo, setReceiptInfo] = useState<ReceiptFiscalInfo | null>(null);
  const [identity, setIdentity] = useState<DocumentIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  // Turno de caixa
  const [session, setSession] = useState<CashSession | null>(null);
  const [showShift, setShowShift] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  const [emitting, setEmitting] = useState(false);
  const [emitError, setEmitError] = useState<string | null>(null);
  const [emitted, setEmitted] = useState<
    { invoice: EmittedInvoice; customerName: string | null; provisional?: boolean } | null
  >(null);

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

  const addToCart = (p: Product) => {
    setEmitError(null);
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { product: p, quantity: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  };

  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.product.id !== id));

  // Scanner de código de barras: lê barcode/código e adiciona ao carrinho.
  useBarcodeScanner((code) => {
    const found = products.find(
      (p) => (p.barcode && p.barcode === code) || p.code.toLowerCase() === code.toLowerCase(),
    );
    if (found) {
      addToCart(found);
    } else {
      setEmitError(`Código não encontrado: ${code}`);
      setTimeout(() => setEmitError(null), 2000);
    }
  });

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
    setEmitted({ invoice: provisionalInvoice, customerName: customer?.name ?? null, provisional: true });
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
      setEmitted({ invoice, customerName: customer?.name ?? null });
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
    setCustomer(null);
  };

  return (
    <div className="app-bg">
      <div className="pos">
        <header className="topbar">
          <img className="topbar-logo" src={LOGO_SRC} alt={SYSTEM_SHORT} />
          <div className="who">
            <div className="name">{identity?.companyName || `${SYSTEM_SHORT} · Caixa`}</div>
            <div className="role">
              {user?.email} · {user?.role ? ROLE_LABELS[user.role] ?? user.role : 'Equipa'}
            </div>
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
          <button className="icon-btn" onClick={logout} title="Terminar sessão">
            <IconLogout size={22} />
          </button>
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
                />
              </div>
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
                {filtered.map((p) => (
                  <button key={p.id} className="prod" onClick={() => addToCart(p)}>
                    <div>
                      <div className="pname">{p.name}</div>
                      <div className="pcode">{p.code}</div>
                    </div>
                    <div className="pfoot">
                      <span className="pprice">{formatKz(grossUnit(p))}</span>
                      <span className="iva-badge">{p.iva_code}</span>
                    </div>
                  </button>
                ))}
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
                {cart.map((l) => (
                  <div className="cart-line" key={l.product.id}>
                    <div className="cl-top">
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
          provisional={emitted.provisional}
          onClose={closeReceipt}
        />
      ) : null}

      {showQueue ? <QueueModal onClose={() => setShowQueue(false)} /> : null}

      {showShift ? (
        <ShiftModal
          session={session}
          onOpened={async () => { setShowShift(false); setSession(await api.currentSession().catch(() => null)); }}
          onClosed={async () => { setShowShift(false); setSession(null); }}
          onClose={() => setShowShift(false)}
        />
      ) : null}

      {showPayment ? (
        <PaymentModal
          total={totals.gross}
          busy={emitting}
          onConfirm={doEmit}
          onClose={() => setShowPayment(false)}
        />
      ) : null}
    </div>
  );
}
