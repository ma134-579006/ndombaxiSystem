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
  IconTrash,
} from '../components/Icons';
import { formatKz } from '../format';
import { useStore } from '../state/StoreContext';
import { useCustomer } from '../store/customer';
import { CustomerModal } from '../components/CustomerModal';
import { ProductCard } from '../components/ProductCard';
import { Typewriter } from '../components/Typewriter';
import { LiveLocation } from '../components/LiveLocation';
import { ProductPage } from './ProductPage';
import { cartCount, cartTotal } from '../store/cart';
import { Checkout } from '../views/Checkout';
import { Confirmation } from '../views/Confirmation';
import { Track } from '../views/Track';

type View = 'home' | 'results' | 'product' | 'checkout' | 'confirmation' | 'track';
type Sort = 'relevance' | 'price-asc' | 'price-desc' | 'name';
const lastOrderKey = (code: string) => `ndombaxi.store.lastorder.${code}`;

const SORTS: { key: Sort; label: string }[] = [
  { key: 'relevance', label: 'Relevância' },
  { key: 'price-asc', label: 'Preço ↑' },
  { key: 'price-desc', label: 'Preço ↓' },
  { key: 'name', label: 'Nome' },
];

export function Storefront() {
  const { code, data, cart, addToCart, setQty, removeFromCart, clearCart } = useStore();
  const [view, setView] = useState<View>('home');
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');       // pesquisa submetida (resultados)
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<Sort>('relevance');
  const [checkout, setCheckout] = useState<{ result: CheckoutResult; method: PaymentMethod | null } | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const customer = useCustomer(code);

  const openOrder = (orderId: string) => { setAccountOpen(false); setTrackId(orderId); setView('track'); };
  const accountModal = accountOpen
    ? <CustomerModal code={code} session={customer} onClose={() => setAccountOpen(false)} onOpenOrder={openOrder} />
    : null;

  // Conta obrigatória para finalizar/track/chat (estilo marketplace).
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const requireAccount = (msg: string, then: () => void) => {
    if (customer) { setGateMsg(null); then(); return; }
    setGateMsg(msg);
    setAccountOpen(true);
  };
  useEffect(() => { if (customer) setGateMsg(null); }, [customer]);
  useEffect(() => {
    if (!customer && (view === 'checkout' || view === 'track')) {
      setView('home');
      setAccountOpen(true);
      setGateMsg('Entre na sua conta para continuar.');
    }
  }, [customer, view]);

  useEffect(() => {
    try { const raw = localStorage.getItem(lastOrderKey(code)); setSavedOrder(raw ? JSON.parse(raw) : null); }
    catch { setSavedOrder(null); }
  }, [code, view]);

  const products = data?.products ?? [];
  const storeName = data?.settings.brand_name || data?.storeName || 'Loja';
  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const featured = useMemo(() => products.filter((p) => p.inStock).slice(0, 12), [products]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = products.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q)
        || (p.description ?? '').toLowerCase().includes(q)
        || p.code.toLowerCase().includes(q);
    });
    if (sort === 'price-asc') list = [...list].sort((a, b) => a.grossPrice - b.grossPrice);
    else if (sort === 'price-desc') list = [...list].sort((a, b) => b.grossPrice - a.grossPrice);
    else if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products, query, cat, sort]);

  const total = cartTotal(cart);
  const count = cartCount(cart);

  const goHome = () => { setView('home'); setCartOpen(false); };
  const doSearch = () => { setQuery(search); setCat(''); setView('results'); window.scrollTo({ top: 0 }); };
  const openCategory = (c: string) => { setCat(c); setQuery(''); setSearch(''); setView('results'); window.scrollTo({ top: 0 }); };
  const openProduct = (p: CatalogProduct) => { setSelected(p); setView('product'); };

  const scanResolve = (raw: string): boolean => {
    const c = raw.trim();
    if (!c) return false;
    const p = products.find((x) => x.code.toLowerCase() === c.toLowerCase());
    if (p && p.inStock) { addToCart(p); setCartOpen(true); return true; }
    setSearch(c); setQuery(c); setView('results');
    return false;
  };

  const onCheckoutDone = (result: CheckoutResult, method: PaymentMethod | null) => {
    setCheckout({ result, method });
    localStorage.setItem(lastOrderKey(code), JSON.stringify({ id: result.id, orderNumber: result.orderNumber }));
    clearCart();
    setView('confirmation');
  };

  const buyNow = (p: CatalogProduct, qty: number) => {
    addToCart(p, qty);
    requireAccount('Crie uma conta ou entre para finalizar a compra.', () => { setCartOpen(false); setView('checkout'); });
  };

  const headerProps = {
    onHome: goHome,
    onCart: () => setCartOpen(true),
    onAccount: () => setAccountOpen(true),
    search, onSearchChange: setSearch, onSearchSubmit: doSearch, onScan: scanResolve,
  };

  // ── Vistas dedicadas (checkout/confirmação/track) ──
  if (view === 'checkout') {
    return (<><Header onHome={goHome} onCart={() => setCartOpen(true)} onAccount={() => setAccountOpen(true)} />
      <Checkout onBack={goHome} onDone={onCheckoutDone} />{accountModal}{renderCart()}</>);
  }
  if (view === 'confirmation' && checkout) {
    return (<><Header onHome={goHome} onCart={() => setCartOpen(true)} onAccount={() => setAccountOpen(true)} />
      <Confirmation order={checkout.result} method={checkout.method}
        onTrack={() => { setTrackId(checkout.result.id); setView('track'); }} onContinue={goHome} />{accountModal}
      <LiveLocation code={code} orderId={checkout.result.id} token={customer?.token} /></>);
  }
  if (view === 'track' && trackId) {
    return (<><Header onHome={goHome} onCart={() => setCartOpen(true)} onAccount={() => setAccountOpen(true)} />
      <Track orderId={trackId} onBack={goHome} />{accountModal}
      <LiveLocation code={code} orderId={trackId} token={customer?.token} /></>);
  }
  if (view === 'product' && selected) {
    const related = products.filter((p) => p.code !== selected.code && (!selected.category || p.category === selected.category)).slice(0, 12);
    return (<><Header {...headerProps} />{accountModal}
      <ProductPage product={selected} storeName={storeName}
        related={related.length ? related : products.filter((p) => p.code !== selected.code).slice(0, 12)}
        onBack={() => setView(query || cat ? 'results' : 'home')}
        onAdd={(p, q) => { addToCart(p, q); setCartOpen(true); }}
        onBuyNow={buyNow} onOpen={openProduct} />
      {renderCart()}
      <FooterBar />
    </>);
  }

  function FooterBar() {
    const s = data?.settings;
    return (
      <footer className="ax-footer">
        <div className="wrap in">
          <div className="store-info">{s?.brand_name || storeName}</div>
          {s?.contact_phone ? <div>{s.contact_phone}</div> : null}
          {s?.contact_email ? <div>{s.contact_email}</div> : null}
          {s?.address ? <div>{s.address}</div> : null}
          <div className="sig">{copyrightLine()}</div>
        </div>
      </footer>
    );
  }

  function renderCart() {
    if (!cartOpen) return null;
    return (
      <div className="drawer-bg" onClick={() => setCartOpen(false)}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="dh">
            <IconCart size={22} /><h2>Carrinho</h2><span className="spacer" />
            <button className="icon-x" onClick={() => setCartOpen(false)}><IconClose size={22} /></button>
          </div>
          {cart.length === 0 ? (
            <div className="body"><div className="empty"><IconCart size={42} /><p>O seu carrinho está vazio.</p></div></div>
          ) : (
            <>
              <div className="body">
                {cart.map((l) => (
                  <div className="cl" key={l.product.code}>
                    {l.product.imageUrl ? <img className="thumb" src={l.product.imageUrl} alt={l.product.name} /> : <div className="thumb"><IconImage size={22} /></div>}
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
                <div className="totline grand"><span>Total</span><span>{formatKz(total)}</span></div>
                <button className="btn lg block" onClick={() => requireAccount('Crie uma conta ou entre para finalizar a compra.', () => { setCartOpen(false); setView('checkout'); })}>
                  Finalizar compra
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── HOME ──
  if (view === 'home') {
    return (
      <>
        <Header {...headerProps} />
        {accountModal}

        {/* Tira de categorias estilo AliExpress */}
        {categories.length > 0 ? (
          <div className="ax-catbar"><div className="wrap ax-catbar-in">
            <button className="ax-catchip" onClick={() => { setCat(''); setQuery(''); setView('results'); }}>Todos os produtos</button>
            {categories.map((c) => <button key={c} className="ax-catchip" onClick={() => openCategory(c)}>{c}</button>)}
          </div></div>
        ) : null}

        <div className="wrap">
          {/* Banner hero */}
          <section className="ax-hero">
            <div className="ax-hero-tx">
              <h1>{data?.settings.brand_name || storeName}</h1>
              <p><Typewriter text={data?.settings.tagline || 'Os melhores produtos, entregues em todo o Angola.'} /></p>
              <button className="btn lg" onClick={() => { setCat(''); setQuery(''); setView('results'); }}>Ver todos os produtos</button>
            </div>
            <div className="ax-hero-badges">
              <div className="b"><span>🚚</span> Envio nacional</div>
              <div className="b"><span>🛡️</span> Compra protegida</div>
              <div className="b"><span>💬</span> Apoio da loja</div>
            </div>
          </section>

          {gateMsg && !customer ? <div className="banner danger" style={{ marginTop: 12 }}>{gateMsg}</div> : null}
          {!customer ? (
            <div className="banner info ax-account-cta" onClick={() => setAccountOpen(true)}>
              👤 <strong>Crie a sua conta grátis</strong> — para comprar, acompanhar encomendas e falar com a loja.
              <span className="spacer" /><IconChevronRight size={18} />
            </div>
          ) : null}
          {savedOrder ? (
            <div className="banner info ax-account-cta" onClick={() => requireAccount('Entre na sua conta para acompanhar as suas encomendas.', () => { setTrackId(savedOrder.id); setView('track'); })}>
              📦 Acompanhar a sua encomenda {savedOrder.orderNumber}<span className="spacer" /><IconChevronRight size={18} />
            </div>
          ) : null}

          {/* Destaques (carrossel horizontal) */}
          {featured.length > 0 ? (
            <section className="ax-section">
              <div className="ax-section-head">
                <h2 className="ax-section-title">⚡ Em destaque</h2>
                <button className="ax-link" onClick={() => { setCat(''); setQuery(''); setView('results'); }}>Ver mais <IconChevronRight size={15} /></button>
              </div>
              <div className="ax-rail">
                {featured.map((p) => <div className="ax-rail-item" key={p.code}><ProductCard product={p} onOpen={openProduct} onAdd={(x) => { addToCart(x); setCartOpen(true); }} /></div>)}
              </div>
            </section>
          ) : null}

          {/* Feed principal */}
          <section className="ax-section">
            <h2 className="ax-section-title">Mais para si</h2>
            {products.length === 0 ? (
              <div className="empty"><IconImage size={48} /><p>A loja ainda não tem produtos visíveis.</p></div>
            ) : (
              <div className="ax-grid">
                {products.map((p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => { addToCart(x); setCartOpen(true); }} />)}
              </div>
            )}
          </section>
        </div>

        <FooterBar />
        {renderCart()}
      </>
    );
  }

  // ── RESULTADOS ──
  return (
    <>
      <Header {...headerProps} />
      {accountModal}

      {categories.length > 0 ? (
        <div className="ax-catbar"><div className="wrap ax-catbar-in">
          <button className={`ax-catchip${cat === '' ? ' on' : ''}`} onClick={() => { setCat(''); }}>Todos</button>
          {categories.map((c) => <button key={c} className={`ax-catchip${cat === c ? ' on' : ''}`} onClick={() => { setCat(c); setQuery(''); setSearch(''); }}>{c}</button>)}
        </div></div>
      ) : null}

      <div className="wrap">
        <div className="ax-results-head">
          <div className="ax-results-title">
            {query ? <>Resultados para “<strong>{query}</strong>”</> : cat ? <>{cat}</> : 'Todos os produtos'}
            <span className="ax-results-count">{results.length} produto(s)</span>
          </div>
          <div className="ax-sort">
            {SORTS.map((sopt) => (
              <button key={sopt.key} className={`ax-sort-chip${sort === sopt.key ? ' on' : ''}`} onClick={() => setSort(sopt.key)}>{sopt.label}</button>
            ))}
          </div>
        </div>

        {results.length === 0 ? (
          <div className="empty"><IconImage size={48} /><p>Nenhum produto encontrado.</p></div>
        ) : (
          <div className="ax-grid">
            {results.map((p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => { addToCart(x); setCartOpen(true); }} />)}
          </div>
        )}
      </div>

      <FooterBar />
      {renderCart()}
    </>
  );
}
