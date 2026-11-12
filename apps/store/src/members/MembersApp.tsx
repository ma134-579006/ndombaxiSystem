import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './members.css';
import { api, ApiError } from '../api/client';
import type { CatalogProduct, CheckoutResult, PaymentMethod } from '../api/types';
import { useStore } from '../state/StoreContext';
import { clearSession, useCustomer } from '../store/customer';
import { cartCount } from '../store/cart';
import { Checkout } from '../views/Checkout';
import { Confirmation } from '../views/Confirmation';
import { Track } from '../views/Track';
import { StoreChat } from '../components/StoreChat';
import { BRAND, Card, I, Mark, P } from './parts';
import { Home, type Banner } from './Home';
import { Search, type SearchState } from './Search';
import { Product } from './Product';
import { Account, CartView, LoginScreen, MembershipScreen, type Membership } from './Pages';
import { Affiliates, type AffTab } from './Affiliates';

/* ───────────── rotas no endereço (#/…): o botão voltar do navegador funciona ───────────── */
type Route =
  | { name: 'home' }
  | { name: 'search'; s: SearchState }
  | { name: 'product'; code: string }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'track'; id: string }
  | { name: 'account'; tab: 'orders' | 'coupons' | 'profile' }
  | { name: 'associates'; tab: AffTab };

function parse(hash: string): Route {
  const [path, qs] = hash.replace(/^#\/?/, '').split('?');
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(qs ?? '');
  switch (seg[0]) {
    case 'busca': return { name: 'search', s: { q: q.get('q') ?? '', cat: q.get('cat') ?? undefined, promo: q.get('promo') === '1' } };
    case 'produto': return seg[1] ? { name: 'product', code: seg[1] } : { name: 'home' };
    case 'carrinho': return { name: 'cart' };
    case 'pagamento': return { name: 'checkout' };
    case 'encomenda': return seg[1] ? { name: 'track', id: seg[1] } : { name: 'home' };
    case 'associados': return { name: 'associates', tab: ({ painel: 'dashboard', vendas: 'sales', meus: 'mine', saques: 'transactions', saldo: 'transactions', contas: 'accounts', mercado: 'market' } as Record<string, AffTab>)[seg[1] ?? ''] ?? 'dashboard' };
    case 'conta': return { name: 'account', tab: seg[1] === 'cupoes' ? 'coupons' : seg[1] === 'perfil' ? 'profile' : 'orders' };
    default: return { name: 'home' };
  }
}
function toHash(r: Route): string {
  switch (r.name) {
    case 'search': {
      const q = new URLSearchParams();
      if (r.s.q) q.set('q', r.s.q);
      if (r.s.cat) q.set('cat', r.s.cat);
      if (r.s.promo) q.set('promo', '1');
      const s = q.toString();
      return `#/busca${s ? `?${s}` : ''}`;
    }
    case 'product': return `#/produto/${encodeURIComponent(r.code)}`;
    case 'cart': return '#/carrinho';
    case 'checkout': return '#/pagamento';
    case 'track': return `#/encomenda/${encodeURIComponent(r.id)}`;
    case 'account': return `#/conta/${r.tab === 'coupons' ? 'cupoes' : r.tab === 'profile' ? 'perfil' : 'compras'}`;
    case 'associates': return `#/associados/${({ dashboard: 'painel', sales: 'vendas', mine: 'meus', transactions: 'saques', accounts: 'contas', market: 'mercado' } as Record<AffTab, string>)[r.tab]}`;
    default: return '#/';
  }
}

const openChat = () => (document.querySelector('.store-chat-fab') as HTMLButtonElement | null)?.click();

export function MembersApp() {
  const { code, data, cart, addToCart, setQty, removeFromCart, clearCart } = useStore();
  const session = useCustomer(code);
  const token = session?.token ?? '';
  const [member, setMember] = useState<Membership | null>(null);
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ id: number; t: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(false);
  const [done, setDone] = useState<{ result: CheckoutResult; method: PaymentMethod | null } | null>(null);

  // Rotas: muda o endereço; o navegador (voltar/avançar) volta a renderizar.
  useEffect(() => {
    const on = () => { setRoute(parse(location.hash)); setLoading(true); window.setTimeout(() => setLoading(false), 450); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route) => {
    const h = toHash(r);
    if (location.hash === h) setRoute(r); else location.hash = h;
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => { if (route.name === 'search') setQ(route.s.q); }, [route]);

  // Cabeçalho compacto ao descer (a faixa de contactos recolhe).
  useEffect(() => {
    const on = () => setCompact((c) => (c ? window.scrollY > 10 : window.scrollY > 90));
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const flash = useCallback((t: string) => { const id = Date.now(); setToast({ id, t }); window.setTimeout(() => setToast((x) => (x && x.id === id ? null : x)), 2600); }, []);

  // Estado de associado (a cada sessão).
  useEffect(() => {
    if (!token) { setMember(null); return; }
    let alive = true;
    api.myMembership(code, token).then((r) => { if (alive) setMember(r.status); })
      .catch((e) => { if (alive && e instanceof ApiError && (e.status === 401 || e.status === 403)) clearSession(code); });
    return () => { alive = false; };
  }, [code, token]);

  // Pedido pendente: a loja abre sozinha quando o gestor aprova.
  useEffect(() => {
    if (member !== 'PENDING' || !token) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      api.myMembership(code, token).then((r) => setMember(r.status)).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(t);
  }, [code, token, member]);

  // Catálogo e anúncios reservados; acesso retirado → volta a perguntar o estado e fecha a loja.
  useEffect(() => {
    if (member !== 'APPROVED' || !token) return;
    let alive = true;
    const lost = (e: unknown) => { if (e instanceof ApiError && (e.status === 400 || e.status === 403)) api.myMembership(code, token).then((m) => { if (alive) setMember(m.status); }).catch(() => undefined); };
    const load = () => api.membersCatalog(code, token).then((r) => { if (alive) setProducts(r.products); }).catch(lost);
    void load();
    api.membersBanners(code, token).then((b) => { if (alive) setBanners(b); }).catch(() => undefined);
    const t = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, [code, token, member]);

  const methods = data?.paymentMethods ?? [];
  const cod = methods.some((m) => m.type === 'CASH');
  const storeName = data?.settings.brand_name || data?.storeName || BRAND;
  const contact = { email: data?.settings.contact_email ?? null, phone: data?.settings.contact_phone ?? null, address: data?.settings.address ?? null };
  const count = cartCount(cart);

  const openProduct = useCallback((c: string) => go({ name: 'product', code: c }), [go]);
  const openSearch = useCallback((qq: string, o?: { cat?: string; promo?: boolean }) => go({ name: 'search', s: { q: qq, cat: o?.cat, promo: o?.promo } }), [go]);
  const openLink = useCallback((link: string | null) => {
    const l = (link ?? '').trim();
    if (!l) return;
    if (/^https?:\/\//i.test(l)) { window.open(l, '_blank', 'noopener'); return; }
    if (products?.some((p) => p.code === l)) { openProduct(l); return; }
    openSearch(l);
  }, [products, openProduct, openSearch]);
  const add = useCallback((p: CatalogProduct, n = 1) => { addToCart(p, n); flash('Adicionado ao carrinho!'); }, [addToCart, flash]);
  const card = useCallback((p: CatalogProduct, hot?: boolean) => <Card p={p} cod={cod} hot={hot} onOpen={() => openProduct(p.code)} onAdd={() => add(p)} />, [cod, openProduct, add]);
  const year = useMemo(() => new Date().getFullYear(), []);

  if (!session) return <LoginScreen code={code} />;
  if (member === null) return <div className="kw-root kw-boot" aria-busy="true"><span className="kw-boot-mark"><Mark size={56} /></span></div>;
  if (member !== 'APPROVED') {
    return (
      <MembershipScreen status={member} busy={busy}
        onRequest={(note) => { setBusy(true); api.requestMembership(code, token, note).then((r) => setMember(r.status)).catch(() => undefined).finally(() => setBusy(false)); }}
        onLogout={() => clearSession(code)} />
    );
  }

  let body: React.ReactNode;
  if (route.name === 'home') body = <Home products={products} banners={banners} methods={methods} card={card} openSearch={openSearch} openProduct={openProduct} openLink={openLink} tagline={data?.settings.tagline} storeName={storeName} />;
  else if (!products) body = <div className="kw-container"><div className="kw-loader" aria-busy="true"><i /><i /><i /></div></div>;
  else if (route.name === 'search') body = <Search products={products} state={route.s} card={card} onState={(s) => go({ name: 'search', s })} />;
  else if (route.name === 'product') body = <Product code={code} token={token} products={products} productCode={route.code} storeName={storeName} methods={methods} cod={cod} contact={contact} onAdd={add} onBuy={(p, n) => { addToCart(p, n); go({ name: 'cart' }); }} card={card} />;
  else if (route.name === 'cart') body = <CartView cart={cart} setQty={setQty} remove={removeFromCart} onNext={() => go({ name: 'checkout' })} onBack={() => go({ name: 'home' })} onOpen={openProduct} />;
  else if (route.name === 'checkout') {
    body = done
      ? <div className="kw-container"><div className="kw-embed"><Confirmation order={done.result} method={done.method} onTrack={() => { const id = done.result.id; setDone(null); go({ name: 'track', id }); }} onContinue={() => { setDone(null); go({ name: 'home' }); }} /></div></div>
      : cart.length
        ? <div className="kw-container"><ol className="kw-steps"><li>1. Carrinho</li><li className="on">2. Pagamento</li></ol><div className="kw-embed"><Checkout onBack={() => go({ name: 'cart' })} onDone={(result, method) => { clearCart(); setDone({ result, method }); window.scrollTo({ top: 0 }); }} /></div></div>
        : <CartView cart={cart} setQty={setQty} remove={removeFromCart} onNext={() => undefined} onBack={() => go({ name: 'home' })} onOpen={openProduct} />;
  }
  else if (route.name === 'track') body = <div className="kw-container"><div className="kw-embed"><Track orderId={route.id} onBack={() => go({ name: 'account', tab: 'orders' })} /></div></div>;
  else if (route.name === 'associates') body = <Affiliates code={code} token={token} products={products} cod={cod} bannerImage={banners[0]?.imageUrl ?? null} tab={route.tab} onTab={(tab) => go({ name: 'associates', tab })} flash={flash} />;
  else body = <Account code={code} token={token} tab={route.tab} onTab={(tab) => go({ name: 'account', tab })} onTrack={(id) => go({ name: 'track', id })} email={session.customer.email} name={session.customer.name} onAssociates={() => go({ name: 'associates', tab: 'market' })} />;

  const first = (session.customer.name || 'Conta').split(' ')[0];
  return (
    <div className="kw-root">
      {loading ? <div className="kw-progress" aria-hidden="true" /> : null}
      <header className={`kw-head${compact ? ' compact' : ''}`}>
        <div className="kw-strip">
          <div className="kw-container kw-strip-in">
            <span className="kw-strip-l">
              <button onClick={() => go({ name: 'associates', tab: 'dashboard' })}>Central do Associado</button>
              {contact.email ? <a href={`mailto:${contact.email}`}><I d={P.mail} size={13} />{contact.email}</a> : null}
              {contact.phone ? <a href={`tel:${contact.phone}`}><I d={P.phone} size={13} />{contact.phone}</a> : null}
            </span>
            <span className="kw-strip-r">
              <button onClick={() => go({ name: 'associates', tab: 'market' })} aria-label="Associados"><I d={P.share} size={16} /><span>Associados</span></button>
              <button onClick={openChat} aria-label="Ajuda"><I d={P.help} size={16} /><span>Ajuda</span></button>
              <button className="kw-strip-me" onClick={() => go({ name: 'account', tab: 'orders' })} aria-label="Conta"><i>{first.slice(0, 1).toUpperCase()}</i><span>{first}</span></button>
            </span>
          </div>
        </div>
        <div className="kw-container kw-head-in">
          <button className="kw-logo" onClick={() => go({ name: 'home' })} aria-label={BRAND}><Mark size={40} /><span><b>LPS</b> Kwanza</span></button>
          <form className="kw-search" role="search" onSubmit={(e) => { e.preventDefault(); openSearch(q.trim()); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produtos, marcas e muito mais…" aria-label="Pesquisar" />
            <button aria-label="Pesquisar"><I d={P.search} size={18} /></button>
          </form>
          <button className="kw-head-ic kw-acc-ic" onClick={() => go({ name: 'account', tab: 'orders' })} aria-label="Conta"><I d={P.user} size={24} /></button>
          <button className="kw-head-ic" onClick={() => go({ name: 'cart' })} aria-label="Carrinho"><I d={P.cart} size={26} />{count > 0 ? <i key={count} className="kw-badge">{count > 99 ? '99+' : count}</i> : null}</button>
        </div>
      </header>

      <main className="kw-main" key={toHash(route)}>{body}</main>

      {toast ? <div key={toast.id} className="kw-toast" role="status"><span className="kw-toast-ic"><I d={P.check} size={16} /></span>{toast.t}<i className="kw-toast-bar" /></div> : null}
      <StoreChat code={code} />

      <footer className="kw-foot">
        <div className="kw-container kw-foot-in">
          <div>
            <h4>{BRAND}</h4>
            <button onClick={() => go({ name: 'account', tab: 'orders' })}>Minhas compras</button>
            <button onClick={() => go({ name: 'account', tab: 'coupons' })}>Meus cupões</button>
            <button onClick={() => go({ name: 'account', tab: 'profile' })}>Perfil e endereço</button>
            <button onClick={() => go({ name: 'associates', tab: 'market' })}>Mercado de Associados</button>
            <button onClick={() => go({ name: 'associates', tab: 'transactions' })}>Transações (Saques)</button>
          </div>
          <div>
            <h4>Consumidor</h4>
            <button onClick={openChat}>Centro de ajuda - Chat</button>
            <button onClick={() => go({ name: 'account', tab: 'orders' })}>Rastrear sua encomenda</button>
          </div>
          <div>
            <h4>Contactos</h4>
            {contact.email ? <a href={`mailto:${contact.email}`}>Email: {contact.email}</a> : null}
            {contact.phone ? <a href={`tel:${contact.phone}`}>Telefone: {contact.phone}</a> : null}
            {contact.address ? <span>{contact.address}</span> : null}
          </div>
          <div>
            <h4>Pagamento</h4>
            <div className="kw-foot-pay">{(methods.length ? methods.map((m) => m.label) : ['Numerário']).map((l) => <span key={l}>{l}</span>)}</div>
          </div>
        </div>
        <div className="kw-foot-copy">© {year} {BRAND} TODOS OS DIREITOS RESERVADOS</div>
      </footer>
    </div>
  );
}
