import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogProduct, CheckoutResult, PaymentMethod } from '../api/types';
import { api } from '../api/client';
import { copyrightLine } from '../brand';
import { Header } from '../components/Header';
import {
  IconCart,
  IconChevronLeft,
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
import { VerticalCTA } from '../components/VerticalRequest';
import { Typewriter } from '../components/Typewriter';
import { LiveLocation } from '../components/LiveLocation';
import { ProductPage } from './ProductPage';
import { cartTotal } from '../store/cart';
import { Checkout } from '../views/Checkout';
import { Confirmation } from '../views/Confirmation';
import { Track } from '../views/Track';

type View = 'home' | 'results' | 'product' | 'visual' | 'checkout' | 'confirmation' | 'track';
type Sort = 'relevance' | 'price-asc' | 'price-desc' | 'name';
const lastOrderKey = (code: string) => `ndombaxi.store.lastorder.${code}`;

/** Portal por MODELO de negócio: ajusta título, CTA e selos da montra. */
interface Portal { tagline: string; cta: string; badges: [string, string][]; feed: string }
const PORTALS: Record<string, Portal> = {
  RETAIL: { tagline: 'Os melhores produtos, entregues em todo o Angola.', cta: 'Ver todos os produtos', badges: [['🚚', 'Envio nacional'], ['🛡️', 'Compra protegida'], ['💬', 'Apoio da loja']], feed: 'Mais para si' },
  PHARMACY: { tagline: 'Medicamentos e bem-estar — encomende online com segurança.', cta: 'Ver produtos', badges: [['💊', 'Medicamentos'], ['🛡️', 'Compra segura'], ['🚚', 'Entrega']], feed: 'Produtos' },
  RESTAURANT: { tagline: 'Peça já — comida fresca, entregue a sua casa.', cta: 'Ver cardápio', badges: [['🍔', 'Cardápio'], ['🛵', 'Entrega'], ['⏱️', 'Rápido']], feed: 'Cardápio' },
  HOSPITALITY: { tagline: 'Reserve a sua estadia — quartos disponíveis online.', cta: 'Ver quartos', badges: [['🛏️', 'Reservas'], ['📅', 'Disponibilidade'], ['💬', 'Apoio']], feed: 'Também disponível' },
  SERVICES: { tagline: 'Peça assistência — abrimos a sua ordem de serviço online.', cta: 'Ver loja', badges: [['🔧', 'Serviços'], ['🧾', 'Orçamento'], ['💬', 'Acompanhamento']], feed: 'Também disponível' },
  CLINIC: { tagline: 'Marque a sua consulta — escolha o dia e a hora.', cta: 'Ver loja', badges: [['🩺', 'Consultas'], ['📅', 'Marcações'], ['🔒', 'Privacidade']], feed: 'Também disponível' },
};

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
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<Sort>('relevance');
  const [checkout, setCheckout] = useState<{ result: CheckoutResult; method: PaymentMethod | null } | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customer = useCustomer(code);
  const portal = PORTALS[data?.businessType ?? 'RETAIL'] ?? PORTALS.RETAIL;

  // Adiciona ao carrinho SEM abrir a gaveta (no telemóvel abrir a cada produto
  // impedia continuar a comprar). Mostra um toast breve como confirmação.
  const addWithToast = (p: CatalogProduct, qty = 1) => {
    addToCart(p, qty);
    setToast(p.name);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  const toastNode = toast ? (
    <div className="ax-toast"><span aria-hidden>🛒</span> <span className="v">{toast}</span> <span>no carrinho</span></div>
  ) : null;

  // ── Pesquisa por imagem (estilo Google Lens) ──
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imgSearching, setImgSearching] = useState(false);
  const [imgResults, setImgResults] = useState<CatalogProduct[] | null>(null);
  const [imgMsg, setImgMsg] = useState<string | null>(null);
  const onImageSearch = () => fileRef.current?.click();
  const onImagePicked = async (file?: File) => {
    if (!file) return;
    setView('visual'); setImgSearching(true); setImgResults(null); setImgMsg(null);
    window.scrollTo({ top: 0 });
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const r = await api.visualSearch(code, base64, file.type || 'image/jpeg');
      setImgResults(r.products || []);
      if (!r.products?.length) setImgMsg(r.message || 'Sem produtos parecidos com a imagem.');
      if (!r.available) setImgMsg(r.message || 'Pesquisa por imagem indisponível de momento.');
    } catch {
      setImgResults([]); setImgMsg('Não foi possível processar a imagem. Tenta outra foto.');
    } finally {
      setImgSearching(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

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
    const q = search.trim().toLowerCase();
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
  }, [products, search, cat, sort]);

  const total = cartTotal(cart);

  const goHome = () => { setView('home'); setCartOpen(false); };
  const openCategory = (c: string) => { setCat(c); setSearch(''); setView('results'); window.scrollTo({ top: 0 }); };
  const openProduct = (p: CatalogProduct) => { setSelected(p); setView('product'); };

  // Pesquisa AUTOMÁTICA: ao escrever, mostra os resultados; ao limpar (sem
  // categoria) volta à página inicial. Não interfere com produto/checkout.
  useEffect(() => {
    if (search.trim() && view === 'home') setView('results');
    else if (!search.trim() && !cat && view === 'results') setView('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
    search, onSearchChange: setSearch, onSearchSubmit: () => undefined, onImageSearch,
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
        onBack={() => setView(search.trim() || cat ? 'results' : 'home')}
        onAdd={(p, q) => addWithToast(p, q)}
        onBuyNow={buyNow} onOpen={openProduct} />
      {renderCart()}
      {toastNode}
      <FooterBar />
    </>);
  }
  if (view === 'visual') {
    return (
      <>
        <Header {...headerProps} />
        {accountModal}
        <div className="wrap">
          <button className="ax-back" onClick={goHome} style={{ marginTop: 14 }}><IconChevronLeft size={18} /> Voltar à loja</button>
          <div className="ax-results-head">
            <div className="ax-results-title">📷 Pesquisa por imagem
              {imgResults ? <span className="ax-results-count">{imgResults.length} produto(s)</span> : null}</div>
          </div>
          {imgSearching ? (
            <div className="empty"><div className="ax-spin" /><p>A analisar a imagem e a procurar produtos parecidos…</p></div>
          ) : imgResults && imgResults.length > 0 ? (
            <div className="ax-grid">
              {imgResults.map((p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} />)}
            </div>
          ) : (
            <div className="empty"><IconImage size={48} /><p>{imgMsg || 'Sem resultados.'}</p>
              <button className="btn" style={{ marginTop: 12 }} onClick={onImageSearch}>Tentar outra foto</button></div>
          )}
        </div>
        <FooterBar />
        {renderCart()}
        {toastNode}
      </>
    );
  }

  function FooterBar() {
    const s = data?.settings;
    return (
      <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => void onImagePicked(e.target.files?.[0] ?? undefined)} />
      <footer className="ax-footer">
        <div className="wrap in">
          <div className="store-info">{s?.brand_name || storeName}</div>
          {s?.contact_phone ? <div>{s.contact_phone}</div> : null}
          {s?.contact_email ? <div>{s.contact_email}</div> : null}
          {s?.address ? <div>{s.address}</div> : null}
          <div className="sig">{copyrightLine()}</div>
        </div>
      </footer>
      </>
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
            <button className="ax-catchip" onClick={() => { setCat(''); setSearch(''); setView('results'); }}>Todos os produtos</button>
            {categories.map((c) => <button key={c} className="ax-catchip" onClick={() => openCategory(c)}>{c}</button>)}
          </div></div>
        ) : null}

        <div className="wrap">
          {/* Banner hero (adaptado ao modelo de negócio) */}
          <section className="ax-hero">
            <div className="ax-hero-tx">
              <h1>{data?.settings.brand_name || storeName}</h1>
              <p><Typewriter text={data?.settings.tagline || portal.tagline} /></p>
              <button className="btn lg" onClick={() => { setCat(''); setSearch(''); setView('results'); }}>{portal.cta}</button>
            </div>
            <div className="ax-hero-badges">
              {portal.badges.map(([ic, tx]) => <div className="b" key={tx}><span>{ic}</span> {tx}</div>)}
            </div>
          </section>

          {/* CTA do vertical (Hotelaria → reservar; Serviços → pedir serviço) */}
          {data?.businessType ? (
            <VerticalCTA code={code} businessType={data.businessType}
              prefill={customer ? { name: customer.customer.name, email: customer.customer.email } : undefined} />
          ) : null}

          {gateMsg && !customer ? <div className="banner danger" style={{ marginTop: 12 }}>{gateMsg}</div> : null}
          {!customer ? (
            <button className="ax-cta" onClick={() => setAccountOpen(true)}>
              <span className="ic" aria-hidden>👤</span>
              <span className="tx"><strong>Crie a sua conta grátis</strong> — para comprar, acompanhar encomendas e falar com a loja.</span>
              <span className="chev" aria-hidden><IconChevronRight size={18} /></span>
            </button>
          ) : null}
          {savedOrder ? (
            <button className="ax-cta" onClick={() => requireAccount('Entre na sua conta para acompanhar as suas encomendas.', () => { setTrackId(savedOrder.id); setView('track'); })}>
              <span className="ic" aria-hidden>📦</span>
              <span className="tx">Acompanhar a sua encomenda <strong>{savedOrder.orderNumber}</strong></span>
              <span className="chev" aria-hidden><IconChevronRight size={18} /></span>
            </button>
          ) : null}

          {/* Destaques (carrossel horizontal) */}
          {featured.length > 0 ? (
            <section className="ax-section">
              <div className="ax-section-head">
                <h2 className="ax-section-title">⚡ Em destaque</h2>
                <button className="ax-link" onClick={() => { setCat(''); setSearch(''); setView('results'); }}>Ver mais <IconChevronRight size={15} /></button>
              </div>
              <div className="ax-rail">
                {featured.map((p) => <div className="ax-rail-item" key={p.code}><ProductCard product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} /></div>)}
              </div>
            </section>
          ) : null}

          {/* Feed principal */}
          <section className="ax-section">
            <h2 className="ax-section-title">{portal.feed}</h2>
            {products.length === 0 ? (
              <div className="empty"><IconImage size={48} /><p>A loja ainda não tem produtos visíveis.</p></div>
            ) : (
              <div className="ax-grid">
                {products.map((p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} />)}
              </div>
            )}
          </section>
        </div>

        <FooterBar />
        {renderCart()}
        {toastNode}
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
          {categories.map((c) => <button key={c} className={`ax-catchip${cat === c ? ' on' : ''}`} onClick={() => { setCat(c); setSearch(''); }}>{c}</button>)}
        </div></div>
      ) : null}

      <div className="wrap">
        <div className="ax-results-head">
          <div className="ax-results-title">
            {search.trim() ? <>Resultados para “<strong>{search.trim()}</strong>”</> : cat ? <>{cat}</> : 'Todos os produtos'}
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
            {results.map((p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} />)}
          </div>
        )}
      </div>

      <FooterBar />
      {renderCart()}
      {toastNode}
    </>
  );
}
