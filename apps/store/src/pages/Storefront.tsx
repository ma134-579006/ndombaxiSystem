import React, { useEffect, useMemo, useRef, useState } from 'react';
import { readFileProgress } from '../transfer';
import { ProgressiveGrid } from '../components/ProgressiveGrid';
import type { CatalogProduct, CheckoutResult, PaymentMethod } from '../api/types';
import { api } from '../api/client';
import { copyrightLine } from '../brand';
import { Header } from '../components/Header';
import { IconCart, IconChevronLeft, IconChevronRight, IconClose, IconImage, IconMinus, IconPlus, IconTrash, IconUser, IconBox, IconTruck, IconShield, IconChat, IconPill, IconUtensils, IconBike, IconClock, IconBed, IconCalendar, IconWrench, IconReceipt, IconStethoscope, IconLock } from '../components/Icons';

const BADGE_ICONS: Record<string, React.ComponentType<{ size?: number }>> = { truck: IconTruck, shield: IconShield, chat: IconChat, pill: IconPill, utensils: IconUtensils, bike: IconBike, clock: IconClock, bed: IconBed, calendar: IconCalendar, wrench: IconWrench, receipt: IconReceipt, stethoscope: IconStethoscope, lock: IconLock };
function BadgeIcon({ name }: { name: string }) { const I = BADGE_ICONS[name]; return I ? <I size={16} /> : null; }
import { formatKz } from '../format';
import { useStore } from '../state/StoreContext';
import { useCustomer } from '../store/customer';
import { CustomerModal } from '../components/CustomerModal';
import { ProductCard } from '../components/ProductCard';
import { GoStorefront } from '../components/GoStorefront';
import { GoCheckout } from '../components/GoCheckout';
import { SectorHome, SECTOR_REPLACES_FEED } from '../components/SectorHome';
import { Typewriter } from '../components/Typewriter';
import { LiveLocation } from '../components/LiveLocation';
import { ProductPage } from './ProductPage';
import { CouponStrip, FlashDeals, ProductRail } from '../components/Deals';
import { clearSeen, markSeen, usePrefs } from '../store/prefs';
import { IconHeart } from '../components/Icons';
import { cartTotal } from '../store/cart';
import { Checkout } from '../views/Checkout';
import { Confirmation } from '../views/Confirmation';
import { Track } from '../views/Track';
import { useNativeBack } from '../native';

type View = 'home' | 'results' | 'product' | 'visual' | 'checkout' | 'confirmation' | 'track' | 'favorites';
type Sort = 'relevance' | 'sold' | 'price-asc' | 'price-desc' | 'name';
const lastOrderKey = (code: string) => `ndombaxi.store.lastorder.${code}`;

/** Portal por MODELO de negócio: ajusta título, CTA e selos da montra. */
interface Portal { tagline: string; cta: string; badges: [string, string][]; feed: string }
const PORTALS: Record<string, Portal> = {
  RETAIL: { tagline: 'Os melhores produtos, entregues em toda Angola.', cta: 'Ver todos os produtos', badges: [['truck', 'Envio nacional'], ['shield', 'Compra protegida'], ['chat', 'Apoio da loja']], feed: 'Mais para si' },
  PHARMACY: { tagline: 'Medicamentos e bem-estar — encomende online com segurança.', cta: 'Ver produtos', badges: [['pill', 'Medicamentos'], ['shield', 'Compra segura'], ['truck', 'Entrega']], feed: 'Produtos' },
  RESTAURANT: { tagline: 'Peça já — comida fresca, entregue a sua casa.', cta: 'Ver cardápio', badges: [['utensils', 'Cardápio'], ['bike', 'Entrega'], ['clock', 'Rápido']], feed: 'Cardápio' },
  HOSPITALITY: { tagline: 'Reserve a sua estadia — quartos disponíveis online.', cta: 'Ver quartos', badges: [['bed', 'Reservas'], ['calendar', 'Disponibilidade'], ['chat', 'Apoio']], feed: 'Também disponível' },
  SERVICES: { tagline: 'Peça assistência — abrimos a sua ordem de serviço online.', cta: 'Pedir serviço', badges: [['wrench', 'Serviços'], ['receipt', 'Orçamento'], ['chat', 'Acompanhamento']], feed: 'Também disponível' },
  CLINIC: { tagline: 'Marque a sua consulta — escolha o dia e a hora.', cta: 'Marcar consulta', badges: [['stethoscope', 'Consultas'], ['calendar', 'Marcações'], ['lock', 'Privacidade']], feed: 'Também disponível' },
};

const SORTS: { key: Sort; label: string }[] = [
  { key: 'relevance', label: 'Relevância' },
  { key: 'sold', label: 'Mais vendidos' },
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
  // Filtros da listagem (preço, promoção, stock).
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [onlyPromo, setOnlyPromo] = useState(false);
  const [onlyStock, setOnlyStock] = useState(false);
  const { favorites, seen } = usePrefs(code);
  const [checkout, setCheckout] = useState<{ result: CheckoutResult; method: PaymentMethod | null } | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customer = useCustomer(code);
  const portal = PORTALS[data?.businessType ?? 'RETAIL'] ?? PORTALS.RETAIL;
  const sectorFeed = SECTOR_REPLACES_FEED.has(data?.businessType ?? '');

  // Adiciona ao carrinho SEM abrir a gaveta (no telemóvel abrir a cada produto
  // impedia continuar a comprar). Mostra um toast breve como confirmação.
  const addWithToast = (p: CatalogProduct, qty = 1) => {
    // PRODUÇÃO esgotada/em-produção: pergunta ao cliente (Sim/Não) se quer
    // encomendar a produção — igual ao caixa. Só encomenda se confirmar.
    if (p.isProduction && p.availability && p.availability !== 'FREE') {
      const msg = p.availability === 'OUT'
        ? `«${p.name}» está esgotado. Pretende encomendar a produção? Será preparado após aprovação da loja.`
        : `«${p.name}» está em produção. Pretende encomendar mais? Será preparado após aprovação da loja.`;
      if (!window.confirm(msg)) return;
    }
    addToCart(p, qty);
    setToast(p.name);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  const toastNode = toast ? (
    <div className="ax-toast"><span aria-hidden><IconCart size={16} /></span> <span className="v">{toast}</span> <span>no carrinho</span></div>
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
      const dataUrl: string = await readFileProgress(file);
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
    ? <CustomerModal code={code} session={customer} onClose={() => setAccountOpen(false)} onOpenOrder={openOrder} businessType={data?.businessType} />
    : null;

  // Conta obrigatória para finalizar/track/chat (estilo marketplace) — SE houver
  // forma de entrar. Sem e-mail configurado nem Google, o cliente ficava num beco
  // sem saída e a loja não vendia: aí compra-se como CONVIDADO (a API aceita).
  const [guestMode, setGuestMode] = useState(false);
  useEffect(() => {
    let alive = true;
    api.authMethods(code).then((m) => { if (alive) setGuestMode(!m.email && !m.google && !m.quick); }).catch(() => undefined);
    return () => { alive = false; };
  }, [code]);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const requireAccount = (msg: string, then: () => void) => {
    if (customer || guestMode) { setGateMsg(null); then(); return; }
    setGateMsg(msg);
    setAccountOpen(true);
  };
  useEffect(() => { if (customer) setGateMsg(null); }, [customer]);
  useEffect(() => {
    const go = !SECTOR_REPLACES_FEED.has(data?.businessType ?? '') && ['RETAIL', 'PHARMACY'].includes(data?.businessType ?? 'RETAIL');
    if (!customer && !guestMode && ((view === 'checkout' && !go) || view === 'track')) {
      setView('home');
      setAccountOpen(true);
      setGateMsg('Entre na sua conta para continuar.');
    }
  }, [customer, view, guestMode, data?.businessType]);

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
    const lo = Number(priceMin.replace(',', '.')) || 0;
    const hi = Number(priceMax.replace(',', '.')) || 0;
    let list = products.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (lo && p.grossPrice < lo) return false;
      if (hi && p.grossPrice > hi) return false;
      if (onlyPromo && !p.promo) return false;
      if (onlyStock && !p.inStock) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q)
        || (p.description ?? '').toLowerCase().includes(q)
        || p.code.toLowerCase().includes(q);
    });
    if (sort === 'price-asc') list = [...list].sort((a, b) => a.grossPrice - b.grossPrice);
    else if (sort === 'price-desc') list = [...list].sort((a, b) => b.grossPrice - a.grossPrice);
    else if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'sold') list = [...list].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0));
    return list;
  }, [products, search, cat, sort, priceMin, priceMax, onlyPromo, onlyStock]);
  const byCode = useMemo(() => new Map(products.map((p) => [p.code, p])), [products]);
  const favProducts = useMemo(() => favorites.map((c) => byCode.get(c)).filter((p): p is CatalogProduct => !!p), [favorites, byCode]);
  const seenProducts = useMemo(() => seen.map((c) => byCode.get(c)).filter((p): p is CatalogProduct => !!p), [seen, byCode]);
  const bestSellers = useMemo(() => products.filter((p) => (p.sold ?? 0) > 0).sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0)).slice(0, 12), [products]);
  const filtersOn = !!(priceMin || priceMax || onlyPromo || onlyStock);
  const clearFilters = () => { setPriceMin(''); setPriceMax(''); setOnlyPromo(false); setOnlyStock(false); };

  const total = cartTotal(cart);

  const goHome = () => { setView('home'); setCartOpen(false); };

  // Botão VOLTAR do Android (app LPS Loja): fecha camadas e recua uma vista.
  useNativeBack(() => {
    if (cartOpen) { setCartOpen(false); return true; }
    if (accountOpen) { setAccountOpen(false); return true; }
    if (view === 'product') { setView(search.trim() || cat ? 'results' : 'home'); return true; }
    if (view === 'results' || view === 'visual' || view === 'favorites') { setSearch(''); setCat(''); setView('home'); return true; }
    if (view !== 'home') { goHome(); return true; }
    return false;
  });
  const openCategory = (c: string) => { setCat(c); setSearch(''); setView('results'); window.scrollTo({ top: 0 }); };
  const openProduct = (p: CatalogProduct) => { markSeen(code, p.code); setSelected(p); setView('product'); };
  const openAll = (o?: { promo?: boolean; sort?: Sort }) => {
    setCat(''); setSearch(''); clearFilters();
    if (o?.promo) setOnlyPromo(true);
    setSort(o?.sort ?? 'relevance');
    setView('results'); window.scrollTo({ top: 0 });
  };
  const openFavorites = () => { setCartOpen(false); setView('favorites'); window.scrollTo({ top: 0 }); };

  // Pesquisa AUTOMÁTICA: ao escrever, mostra os resultados; ao limpar (sem
  // categoria) volta à página inicial. Não interfere com produto/checkout.
  useEffect(() => {
    if (['RETAIL', 'PHARMACY'].includes(data?.businessType ?? 'RETAIL') && !SECTOR_REPLACES_FEED.has(data?.businessType ?? '')) return;
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
    onFavorites: openFavorites, favCount: favorites.length,
    search, onSearchChange: setSearch, onSearchSubmit: () => undefined, onImageSearch,
  };

  // Modelo das lojas de faturação (retalho/farmácia): produto e finalizar
  // abrem dentro da mesma montra (capa + carrinho), e compra-se SEM conta.
  const goShop = !sectorFeed && ['RETAIL', 'PHARMACY'].includes(data?.businessType ?? 'RETAIL');
  const goProps = {
    storeName: data?.settings.brand_name || storeName, tagline: data?.settings.tagline || portal.tagline,
    products, categories, search, onOpen: openProduct, onAdd: (p: CatalogProduct, q: number) => addWithToast(p, q),
    onCheckout: () => { setCartOpen(false); setView('checkout'); window.scrollTo({ top: 0 }); },
  };
  if (goShop && view === 'checkout') {
    return (<><Header {...headerProps} />{accountModal}
      <GoStorefront {...goProps} title="Finalizar"><GoCheckout onBack={goHome} onDone={onCheckoutDone} /></GoStorefront>
      <FooterBar />{toastNode}</>);
  }
  if (goShop && view === 'product' && selected) {
    return (<><Header {...headerProps} />{accountModal}
      <GoStorefront {...goProps} product={selected} onBack={() => { setView('home'); }} />
      <FooterBar />{renderCart()}{toastNode}</>);
  }

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
  if (view === 'favorites') {
    return (
      <>
        <Header {...headerProps} />
        {accountModal}
        <div className="wrap">
          <button className="ax-back" onClick={goHome} style={{ marginTop: 14 }}><IconChevronLeft size={18} /> Voltar à loja</button>
          <div className="ax-results-head">
            <div className="ax-results-title">Favoritos<span className="ax-results-count">{favProducts.length} produto(s)</span></div>
          </div>
          {favProducts.length === 0 ? (
            <div className="empty"><IconHeart size={48} /><p>Sem favoritos.</p></div>
          ) : (
            <div className="ax-grid">
              {favProducts.map((p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} />)}
            </div>
          )}
          <ProductRail title="Vistos recentemente" items={seenProducts.filter((p) => !favorites.includes(p.code))} onOpen={openProduct} onAdd={(x) => addWithToast(x)} />
        </div>
        <FooterBar />
        {renderCart()}
        {toastNode}
      </>
    );
  }

  if (view === 'visual') {
    return (
      <>
        <Header {...headerProps} />
        {accountModal}
        <div className="wrap">
          <button className="ax-back" onClick={goHome} style={{ marginTop: 14 }}><IconChevronLeft size={18} /> Voltar à loja</button>
          <div className="ax-results-head">
            <div className="ax-results-title">Pesquisa por imagem
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
      <input ref={fileRef} type="file" accept="image/*" capture="environment" aria-label="Pesquisar por imagem" style={{ display: 'none' }}
        onChange={(e) => void onImagePicked(e.target.files?.[0] ?? undefined)} />
      <nav className="ax-side" aria-label="Atalhos">
        <button onClick={() => setCartOpen(true)} aria-label="Carrinho" title="Carrinho"><IconCart size={20} />{cart.length ? <i>{cart.length}</i> : null}</button>
        <button onClick={openFavorites} aria-label="Favoritos" title="Favoritos"><IconHeart size={20} />{favorites.length ? <i>{favorites.length}</i> : null}</button>
        <button className="top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Voltar ao topo" title="Voltar ao topo"><IconChevronLeft size={20} /></button>
      </nav>
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
                <button className="btn lg block" onClick={() => (goShop ? (setCartOpen(false), setView('checkout'), window.scrollTo({ top: 0 })) : requireAccount('Crie uma conta ou entre para finalizar a compra.', () => { setCartOpen(false); setView('checkout'); }))}>
                  Finalizar compra
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── HOME de RETALHO/FARMÁCIA: montra no modelo das lojas online de faturação
  // (capa + logótipo, carrinho e menu à esquerda, grelha paginada). Os setores com
  // montra própria (restaurante, hotel, clínica, serviços) seguem abaixo.
  const goMode = !sectorFeed && ['RETAIL', 'PHARMACY'].includes(data?.businessType ?? 'RETAIL');
  if (goMode && (view === 'home' || view === 'results')) {
    return (
      <>
        <Header {...headerProps} />
        {accountModal}
        {gateMsg && !customer ? <div className="wrap"><div className="banner danger" style={{ marginTop: 12 }}>{gateMsg}</div></div> : null}
        <GoStorefront {...goProps} />
        {savedOrder ? (
          <div className="wrap"><button className="ax-cta" onClick={() => requireAccount('Entre na sua conta para acompanhar as suas encomendas.', () => { setTrackId(savedOrder.id); setView('track'); })}>
            <span className="ic" aria-hidden><IconBox size={18} /></span>
            <span className="tx">Acompanhar a sua encomenda <strong>{savedOrder.orderNumber}</strong></span>
            <span className="chev" aria-hidden><IconChevronRight size={18} /></span>
          </button></div>
        ) : null}
        <FooterBar />
        {renderCart()}
        {toastNode}
      </>
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
            <button className="ax-catchip" onClick={() => openAll()}>Todos os produtos</button>
            {categories.map((c) => <button key={c} className="ax-catchip" onClick={() => openCategory(c)}>{c}</button>)}
          </div></div>
        ) : null}

        <div className="wrap">
          {/* Banner hero (adaptado ao modelo de negócio) */}
          <section className="ax-hero">
            <div className="ax-hero-tx">
              <h1>{data?.settings.brand_name || storeName}</h1>
              <p><Typewriter text={data?.settings.tagline || portal.tagline} /></p>
              <button className="btn lg" onClick={() => {
                const el = document.getElementById('setor');
                if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
                setCat(''); setSearch(''); setView('results');
              }}>{portal.cta}</button>
            </div>
            <div className="ax-hero-badges">
              {portal.badges.map(([ic, tx]) => <div className="b" key={tx}><span><BadgeIcon name={ic} /></span> {tx}</div>)}
            </div>
          </section>


          {gateMsg && !customer ? <div className="banner danger" style={{ marginTop: 12 }}>{gateMsg}</div> : null}
          {!customer ? (
            <button className="ax-cta" onClick={() => setAccountOpen(true)}>
              <span className="ic" aria-hidden><IconUser size={18} /></span>
              <span className="tx"><strong>Crie a sua conta grátis</strong> — para comprar, acompanhar encomendas e falar com a loja.</span>
              <span className="chev" aria-hidden><IconChevronRight size={18} /></span>
            </button>
          ) : null}
          {savedOrder ? (
            <button className="ax-cta" onClick={() => requireAccount('Entre na sua conta para acompanhar as suas encomendas.', () => { setTrackId(savedOrder.id); setView('track'); })}>
              <span className="ic" aria-hidden><IconBox size={18} /></span>
              <span className="tx">Acompanhar a sua encomenda <strong>{savedOrder.orderNumber}</strong></span>
              <span className="chev" aria-hidden><IconChevronRight size={18} /></span>
            </button>
          ) : null}

          {/* Montra própria do setor (cardápio, quartos, médicos, serviços, farmácia) */}
          {data?.businessType ? (
            <SectorHome code={code} businessType={data.businessType} products={products}
              prefill={customer ? { name: customer.customer.name, email: customer.customer.email } : undefined}
              onAdd={(x) => addWithToast(x)} onOpen={openProduct} onCategory={openCategory} />
          ) : null}

          <CouponStrip code={code} />

          {/* Ofertas relâmpago (Promoções activas da gestão) */}
          <FlashDeals products={products} onOpen={openProduct} onAdd={(x) => addWithToast(x)} onMore={() => openAll({ promo: true })} />

          {!sectorFeed ? (
            <ProductRail title="Mais vendidos" items={bestSellers} onOpen={openProduct} onAdd={(x) => addWithToast(x)} onMore={() => openAll({ sort: 'sold' })} />
          ) : null}

          <ProductRail title="Vistos recentemente" items={seenProducts.slice(0, 12)} onOpen={openProduct} onAdd={(x) => addWithToast(x)}
            onMore={() => clearSeen(code)} moreLabel="Limpar" />

          {/* Destaques (carrossel horizontal) */}
          {featured.length > 0 && !sectorFeed ? (
            <section className="ax-section">
              <div className="ax-section-head">
                <h2 className="ax-section-title">Em destaque</h2>
                <button className="ax-link" onClick={() => { setCat(''); setSearch(''); setView('results'); }}>Ver mais <IconChevronRight size={15} /></button>
              </div>
              <div className="ax-rail">
                {featured.map((p) => <div className="ax-rail-item" key={p.code}><ProductCard product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} /></div>)}
              </div>
            </section>
          ) : null}

          {/* Feed principal (o restaurante usa o cardápio; hotel/clínica sem produtos não mostram vazio) */}
          {sectorFeed || (products.length === 0 && ['HOSPITALITY', 'CLINIC', 'SERVICES'].includes(data?.businessType ?? '')) ? null : (
          <section className="ax-section">
            <h2 className="ax-section-title">{portal.feed}</h2>
            {products.length === 0 ? (
              <div className="empty"><IconImage size={48} /><p>A loja ainda não tem produtos visíveis.</p></div>
            ) : (
              <ProgressiveGrid items={products} render={(p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} />} />
            )}
          </section>
          )}
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

        <div className="ax-filters">
          <label className="ax-price-f">
            <span>Preço</span>
            <input inputMode="decimal" placeholder="Mín." value={priceMin} onChange={(e) => setPriceMin(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Preço mínimo" />
            <span>–</span>
            <input inputMode="decimal" placeholder="Máx." value={priceMax} onChange={(e) => setPriceMax(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Preço máximo" />
            <span>Kz</span>
          </label>
          <button className={`ax-sort-chip${onlyPromo ? ' on' : ''}`} aria-pressed={onlyPromo} onClick={() => setOnlyPromo((v) => !v)}>Em promoção</button>
          <button className={`ax-sort-chip${onlyStock ? ' on' : ''}`} aria-pressed={onlyStock} onClick={() => setOnlyStock((v) => !v)}>Disponível</button>
          {filtersOn ? <button className="ax-link" onClick={clearFilters}>Limpar filtros</button> : null}
        </div>

        {results.length === 0 ? (
          <div className="empty"><IconImage size={48} /><p>Nenhum produto encontrado.</p></div>
        ) : (
          <ProgressiveGrid items={results} render={(p) => <ProductCard key={p.code} product={p} onOpen={openProduct} onAdd={(x) => addWithToast(x)} />} />
        )}
      </div>

      <FooterBar />
      {renderCart()}
      {toastNode}
    </>
  );
}
