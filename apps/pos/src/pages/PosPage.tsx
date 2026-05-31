import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Customer, DocumentIdentity, EmittedInvoice, Product, ReceiptFiscalInfo } from '../api/types';
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
import { cartTotals, lineGross, type CartLine } from '../pos/cart';
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

  const totals = cartTotals(cart);

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

  const finalize = async () => {
    if (cart.length === 0 || emitting) return;
    setEmitting(true);
    setEmitError(null);
    try {
      // Sem internet → vai direto para a fila offline (não tenta a rede).
      if (!sync.online) {
        await finalizeOffline();
        return;
      }
      const invoice = await api.emitInvoice({
        customerId: customer?.id,
        lines: cart.map((l) => ({ productCode: l.product.code, quantity: l.quantity })),
      });
      setEmitted({ invoice, customerName: customer?.name ?? null });
    } catch (e) {
      // Falha de rede (status 0) → grava offline em vez de perder a venda.
      if (e instanceof ApiError && e.status === 0) {
        try {
          await finalizeOffline();
          return;
        } catch {
          /* cai no erro genérico abaixo */
        }
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
                      <span className="cl-total">{formatKz(lineGross(l))}</span>
                    </div>
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
                <div className="t-row grand">
                  <span>Total</span>
                  <span>{formatKz(totals.gross)}</span>
                </div>
              </div>

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
    </div>
  );
}
