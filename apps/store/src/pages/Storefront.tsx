import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogProduct, CheckoutResult, PaymentMethod } from '../api/types';
import { copyrightLine } from '../brand';
import { Header } from '../components/Header';
import {
  IconCart,
  IconChevronRight,
  IconClose,
  IconImage,
  IconMinus,
  IconPlus,
  IconSearch,
  IconTrash,
} from '../components/Icons';
import { formatKz } from '../format';
import { useStore } from '../state/StoreContext';
import { useCustomer } from '../store/customer';
import { CustomerModal } from '../components/CustomerModal';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { cartCount, cartTotal } from '../store/cart';
import { Checkout } from '../views/Checkout';
import { Confirmation } from '../views/Confirmation';
import { Track } from '../views/Track';

type View = 'catalog' | 'checkout' | 'confirmation' | 'track';
const lastOrderKey = (code: string) => `ndombaxi.store.lastorder.${code}`;

export function Storefront() {
  const { code, data, cart, addToCart, setQty, removeFromCart, clearCart } = useStore();
  const [view, setView] = useState<View>('catalog');
  const [cartOpen, setCartOpen] = useState(false);
  const [modal, setModal] = useState<CatalogProduct | null>(null);
  const [modalQty, setModalQty] = useState(1);
  const [search, setSearch] = useState('');
  const [checkout, setCheckout] = useState<{ result: CheckoutResult; method: PaymentMethod | null } | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const customer = useCustomer(code);

  const openOrder = (orderId: string) => { setAccountOpen(false); setTrackId(orderId); setView('track'); };
  const accountModal = accountOpen
    ? <CustomerModal code={code} session={customer} onClose={() => setAccountOpen(false)} onOpenOrder={openOrder} />
    : null;

  // CONTA OBRIGATÓRIA (estilo marketplace): sem login, o visitante pode VER os
  // produtos e a montra — mas finalizar compra, histórico de encomendas e chat
  // exigem conta. Sem conta → abre o login/registo do cliente.
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const requireAccount = (msg: string, then: () => void) => {
    if (customer) { setGateMsg(null); then(); return; }
    setGateMsg(msg);
    setAccountOpen(true);
  };
  useEffect(() => { if (customer) setGateMsg(null); }, [customer]);
  // Vistas protegidas: se a sessão não existir, volta ao catálogo.
  useEffect(() => {
    if (!customer && (view === 'checkout' || view === 'track')) {
      setView('catalog');
      setAccountOpen(true);
      setGateMsg('Entre na sua conta para continuar.');
    }
  }, [customer, view]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(lastOrderKey(code));
      setSavedOrder(raw ? JSON.parse(raw) : null);
    } catch {
      setSavedOrder(null);
    }
  }, [code, view]);

  const products = data?.products ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q)
        || (p.description ?? '').toLowerCase().includes(q)
        || p.code.toLowerCase().includes(q),
    );
  }, [products, search]);

  // Câmara: ao reconhecer um código de barras associado a um produto da loja,
  // adiciona ao carrinho (se houver stock); devolve true para a câmara fechar.
  const scanResolve = (raw: string): boolean => {
    const c = raw.trim();
    if (!c) return false;
    const p = products.find((x) => x.code.toLowerCase() === c.toLowerCase());
    if (p && p.inStock) { addToCart(p); return true; }
    setSearch(c); // não existe / sem stock → fica na pesquisa
    return false;
  };

  const total = cartTotal(cart);
  const count = cartCount(cart);

  const goHome = () => {
    setView('catalog');
    setCartOpen(false);
  };

  const onCheckoutDone = (result: CheckoutResult, method: PaymentMethod | null) => {
    setCheckout({ result, method });
    localStorage.setItem(lastOrderKey(code), JSON.stringify({ id: result.id, orderNumber: result.orderNumber }));
    clearCart();
    setView('confirmation');
  };

  const openProduct = (p: CatalogProduct) => {
    setModal(p);
    setModalQty(1);
  };

  // ── Vistas dedicadas ──
  if (view === 'checkout') {
    return (
      <>
        <Header onHome={goHome} onCart={() => setCartOpen(true)} onAccount={() => setAccountOpen(true)} />
        <Checkout onBack={goHome} onDone={onCheckoutDone} />
        {accountModal}
        {renderCart()}
      </>
    );
  }
  if (view === 'confirmation' && checkout) {
    return (
      <>
        <Header onHome={goHome} onCart={() => setCartOpen(true)} onAccount={() => setAccountOpen(true)} />
        <Confirmation
          order={checkout.result}
          method={checkout.method}
          onTrack={() => {
            setTrackId(checkout.result.id);
            setView('track');
          }}
          onContinue={goHome}
        />
        {accountModal}
      </>
    );
  }
  if (view === 'track' && trackId) {
    return (
      <>
        <Header onHome={goHome} onCart={() => setCartOpen(true)} onAccount={() => setAccountOpen(true)} />
        <Track orderId={trackId} onBack={goHome} />
        {accountModal}
      </>
    );
  }

  // ── Catálogo ──
  function renderCart() {
    if (!cartOpen) return null;
    return (
      <div className="drawer-bg" onClick={() => setCartOpen(false)}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="dh">
            <IconCart size={22} />
            <h2>Carrinho</h2>
            <span className="spacer" />
            <button className="icon-x" onClick={() => setCartOpen(false)}>
              <IconClose size={22} />
            </button>
          </div>
          {cart.length === 0 ? (
            <div className="body">
              <div className="empty">
                <IconCart size={42} />
                <p>O seu carrinho está vazio.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="body">
                {cart.map((l) => (
                  <div className="cl" key={l.product.code}>
                    {l.product.imageUrl ? (
                      <img className="thumb" src={l.product.imageUrl} alt={l.product.name} />
                    ) : (
                      <div className="thumb"><IconImage size={22} /></div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div className="nm">{l.product.name}</div>
                      <div className="pr">{formatKz(l.product.grossPrice)}</div>
                      <div className="stepper">
                        <button onClick={() => setQty(l.product.code, l.quantity - 1)}><IconMinus size={16} /></button>
                        <span className="q">{l.quantity}</span>
                        <button onClick={() => setQty(l.product.code, l.quantity + 1)}><IconPlus size={16} /></button>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <button className="icon-x" onClick={() => removeFromCart(l.product.code)}><IconTrash size={18} /></button>
                      <div style={{ fontWeight: 800 }}>{formatKz(l.product.grossPrice * l.quantity)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="foot">
                <div className="totline grand">
                  <span>Total</span>
                  <span>{formatKz(total)}</span>
                </div>
                <button
                  className="btn lg block"
                  onClick={() => requireAccount('Crie uma conta ou entre para finalizar a compra.', () => {
                    setCartOpen(false);
                    setView('checkout');
                  })}
                >
                  Finalizar compra
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Header onHome={goHome} onCart={() => setCartOpen(true)} onAccount={() => setAccountOpen(true)} />
      {accountModal}
      <div className="wrap">
        <section className="hero">
          <h1>{data?.settings.brand_name || data?.storeName || 'Bem-vindo'}</h1>
          <p>{data?.settings.tagline || 'Os melhores produtos, entregues em Angola.'}</p>

          {gateMsg && !customer ? (
            <div className="banner danger" style={{ marginTop: 12 }}>{gateMsg}</div>
          ) : null}
          {!customer ? (
            <div className="banner info" style={{ marginTop: 12, cursor: 'pointer' }} onClick={() => setAccountOpen(true)}>
              👤 <strong>Crie a sua conta grátis</strong> — para comprar, acompanhar encomendas e falar com a loja.
              <span className="spacer" />
              <IconChevronRight size={18} />
            </div>
          ) : null}

          {savedOrder ? (
            <div
              className="banner info"
              style={{ marginTop: 16, cursor: 'pointer' }}
              onClick={() => requireAccount('Entre na sua conta para acompanhar as suas encomendas.', () => {
                setTrackId(savedOrder.id);
                setView('track');
              })}
            >
              Acompanhar a sua encomenda {savedOrder.orderNumber}
              <span className="spacer" />
              <IconChevronRight size={18} />
            </div>
          ) : null}

          <div className="search">
            <IconSearch size={20} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar por nome ou código de barras…" />
            <BarcodeScanner onDetected={(code) => scanResolve(code)} />
          </div>
        </section>

        {filtered.length === 0 ? (
          <div className="empty">
            <IconImage size={48} />
            <p>{search ? 'Nenhum produto encontrado.' : 'A loja ainda não tem produtos visíveis.'}</p>
          </div>
        ) : (
          <div className="products">
            {filtered.map((p) => (
              <div className="product" key={p.code}>
                <button className="ph" onClick={() => openProduct(p)} aria-label={p.name}>
                  {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <IconImage size={40} />}
                </button>
                <div className="body">
                  <button className="nm" onClick={() => openProduct(p)} style={{ textAlign: 'left', background: 'none' }}>
                    {p.name}
                  </button>
                  {p.description ? <div className="ds">{p.description}</div> : <div className="ds" />}
                  <div className="ft">
                    <span className="pr">{formatKz(p.grossPrice)}</span>
                    {p.inStock ? (
                      <button className="add-btn" onClick={() => addToCart(p)} aria-label="Adicionar"><IconPlus size={20} /></button>
                    ) : (
                      <span className="badge out">Esgotado</span>
                    )}
                  </div>
                  {p.inStock
                    ? (typeof p.stockQty === 'number'
                        ? <div className={`stock-tag${p.stockQty <= 5 ? ' low' : ''}`}>{p.stockQty} em stock</div>
                        : null)
                    : <div className="stock-tag out">Esgotado</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="footer">
        <div className="in">
          <div className="store-info">{data?.settings.brand_name || data?.storeName}</div>
          {data?.settings.contact_phone ? <div>{data.settings.contact_phone}</div> : null}
          {data?.settings.contact_email ? <div>{data.settings.contact_email}</div> : null}
          {data?.settings.address ? <div>{data.settings.address}</div> : null}
          <div className="sig">{copyrightLine()}</div>
        </div>
      </footer>

      {renderCart()}

      {modal ? (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {modal.imageUrl ? (
              <img className="modal-img" src={modal.imageUrl} alt={modal.name} />
            ) : (
              <div className="modal-img center" style={{ color: '#c2cad6' }}><IconImage size={48} /></div>
            )}
            <div className="mh">
              <h3>{modal.name}</h3>
              <span className="spacer" />
              <button className="icon-x" onClick={() => setModal(null)}><IconClose size={22} /></button>
            </div>
            <div className="mb">
              {modal.description ? <p className="muted" style={{ marginTop: 0 }}>{modal.description}</p> : null}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0 18px' }}>
                <span style={{ fontSize: 24, fontWeight: 900 }}>{formatKz(modal.grossPrice)}</span>
                <div className="stepper">
                  <button onClick={() => setModalQty((q) => Math.max(1, q - 1))}><IconMinus size={16} /></button>
                  <span className="q">{modalQty}</span>
                  <button onClick={() => setModalQty((q) => q + 1)}><IconPlus size={16} /></button>
                </div>
              </div>
              <button
                className="btn lg block"
                disabled={!modal.inStock}
                onClick={() => {
                  addToCart(modal, modalQty);
                  setModal(null);
                  setCartOpen(true);
                }}
              >
                {modal.inStock ? 'Adicionar ao carrinho' : 'Esgotado'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
