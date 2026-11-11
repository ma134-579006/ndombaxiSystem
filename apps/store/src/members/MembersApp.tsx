import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './members.css';
import { api, ApiError } from '../api/client';
import { GOOGLE_CLIENT_ID } from '../config';
import type { CatalogProduct, CheckoutResult, MyOrderRow, PaymentMethod, PublicCoupon } from '../api/types';
import { useStore } from '../state/StoreContext';
import { clearSession, setSession, shownEmail, useCustomer } from '../store/customer';
import { cartCount, cartTotal } from '../store/cart';
import { formatKz, formatDateTime } from '../format';
import { Checkout } from '../views/Checkout';
import { Confirmation } from '../views/Confirmation';
import { Track } from '../views/Track';

type Membership = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
type View =
  | { name: 'home' }
  | { name: 'search'; q: string; cat?: string; promo?: boolean }
  | { name: 'product'; code: string }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'done'; result: CheckoutResult; method: PaymentMethod | null }
  | { name: 'track'; id: string }
  | { name: 'account'; tab: 'orders' | 'coupons' | 'profile' };

/* ───────────────────────── ícones (traço simples, próprios) ───────────────────────── */
const I = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const P = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M10 21h.01M18 21h.01',
  user: 'M20 21a8 8 0 0 0-16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  back: 'M15 18l-6-6 6-6',
  close: 'M18 6 6 18M6 6l12 12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  check: 'M20 6 9 17l-5-5',
  filter: 'M3 5h18M6 12h12M10 19h4',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

/** Marca da LPS Kwanza: azul cromado e carrinho, no estilo do logótipo LPS Vendas. */
function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs><linearGradient id="ma-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5d6bff" /><stop offset="1" stopColor="#1a24c4" /></linearGradient></defs>
      <rect width="40" height="40" rx="10" fill="url(#ma-g)" />
      <path d="M6 11h4l3.2 13a2 2 0 0 0 2 1.5h10.6a2 2 0 0 0 2-1.5L30 15H11" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="31" r="2.2" fill="#fff" /><circle cx="26" cy="31" r="2.2" fill="#fff" />
      <path d="M4 21c4-8 14-12 30-9" fill="none" stroke="#bcc6ff" strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
    </svg>
  );
}

const BRAND = 'LPS Kwanza';

const pct = (p: CatalogProduct): number => p.promo?.percent ?? (p.listPrice && p.listPrice > p.grossPrice ? Math.round((1 - p.grossPrice / p.listPrice) * 100) : 0);

function Pic({ p, className = '' }: { p: CatalogProduct; className?: string }) {
  return p.imageUrl
    ? <img className={`ma-pic ${className}`} src={p.imageUrl} alt={p.name} loading="lazy" />
    : <div className={`ma-pic ma-pic-ph ${className}`} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</div>;
}

/* ───────────────────────── entrada: login ───────────────────────── */
const GIS_SRC = 'https://accounts.google.com/gsi/client';
function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { google?: { accounts?: { id?: unknown } } };
    if (w.google?.accounts?.id) return resolve();
    const ex = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (ex) { ex.addEventListener('load', () => resolve()); ex.addEventListener('error', () => reject(new Error('gis'))); return; }
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('gis'));
    document.head.appendChild(s);
  });
}

function LoginScreen({ code, brand }: { code: string; brand: string }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [methods, setMethods] = useState<{ email: boolean; google: boolean; quick?: boolean } | null>(null);
  const gbtn = useRef<HTMLDivElement | null>(null);
  useEffect(() => { api.authMethods(code).then(setMethods).catch(() => setMethods({ email: false, google: false, quick: true })); }, [code]);
  const googleOn = GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com') && (methods?.google ?? true);
  const emailOn = !!methods?.email;

  useEffect(() => {
    if (!googleOn) return;
    let alive = true;
    loadGis().then(() => {
      const g = (window as unknown as { google?: any }).google;
      if (!alive || !g?.accounts?.id) return;
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential?: string }) => {
          if (!resp.credential) return;
          setBusy(true); setErr(null);
          try { setSession(code, await api.authGoogle(code, resp.credential)); }
          catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha no login com Google.'); }
          finally { setBusy(false); }
        },
      });
      if (gbtn.current) g.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', width: 300, text: 'continue_with' });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [code, googleOn]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    if (!emailOn) {
      // Conta rápida (sem email): nome e telefone chegam; o gestor aprova a adesão.
      if (!name.trim() || phone.replace(/\D/g, '').length < 9) { setErr('Indique o nome e o telefone.'); return; }
      setBusy(true);
      try { setSession(code, await api.authQuick(code, { name: name.trim(), phone: phone.trim() })); }
      catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar.'); }
      finally { setBusy(false); }
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Indique um email válido.'); return; }
    setBusy(true);
    try {
      if (!sent) { await api.authEmailCode(code, email.trim()); setSent(true); return; }
      if (!/^\d{6}$/.test(otp.trim())) { setErr('Indique o código de 6 dígitos.'); return; }
      setSession(code, await api.authEmail(code, email.trim(), name.trim() || undefined, undefined, otp.trim()));
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="ma-root ma-auth">
      <form className="ma-auth-card" onSubmit={(e) => void submit(e)}>
        <div className="ma-auth-brand"><img className="ma-auth-logo" src="/logo-mark.png" alt="LPS Vendas" width={150} height={150} /><strong>{brand}</strong></div>
        {googleOn ? <><div ref={gbtn} className="ma-gbtn" /><div className="ma-or"><span>ou</span></div></> : null}
        <h2>{emailOn ? 'Entra com o seu email' : 'Entra com o seu contacto'}</h2>
        {!methods ? <div className="ma-state" aria-busy="true" /> : emailOn ? (
          <>
            <label className="ma-f"><span>Email</span>
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); setOtp(''); }} placeholder="exemplo@email.com" autoComplete="email" disabled={sent} /></label>
            {sent ? (
              <>
                <label className="ma-f"><span>Nome (se é a primeira vez)</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
                <label className="ma-f"><span>Código recebido por email</span>
                  <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus /></label>
              </>
            ) : null}
          </>
        ) : (
          <>
            <label className="ma-f"><span>Nome</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label className="ma-f"><span>Telefone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="9XX XXX XXX" /></label>
          </>
        )}
        {err ? <div className="ma-err" role="alert">{err}</div> : null}
        <button className="ma-btn ma-btn-primary ma-block" disabled={busy}>{busy ? 'Um momento…' : !emailOn || sent ? 'Entrar' : 'Próximo'}</button>
        {sent ? <button type="button" className="ma-link" onClick={() => { setSent(false); setOtp(''); setErr(null); }}>Mudar de email</button> : null}
      </form>
    </div>
  );
}

/** Pedido de adesão / à espera de aprovação. */
function MembershipScreen({ status, brand, busy, onRequest, onLogout }: {
  status: Membership; brand: string; busy: boolean; onRequest(note: string): void; onLogout(): void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="ma-root ma-auth">
      <div className="ma-auth-card">
        <div className="ma-auth-brand"><img className="ma-auth-logo" src="/logo-mark.png" alt="LPS Vendas" width={150} height={150} /><strong>{brand}</strong></div>
        {status === 'PENDING' ? (
          <div className="ma-state"><span className="ma-pill ma-pill-warn">Pedido em análise</span></div>
        ) : (
          <>
            <h2>Pedir adesão</h2>
            {status === 'REJECTED' ? <div className="ma-err" role="alert">Adesão recusada</div> : null}
            <label className="ma-f"><span>Mensagem (opcional)</span>
              <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
            <button className="ma-btn ma-btn-primary ma-block" disabled={busy} onClick={() => onRequest(note)}>{busy ? 'Um momento…' : 'Pedir adesão'}</button>
          </>
        )}
        <button className="ma-link" onClick={onLogout}>Terminar sessão</button>
      </div>
    </div>
  );
}

/* ───────────────────────── cartões e secções ───────────────────────── */
function Card({ p, onOpen, onAdd, cod }: { p: CatalogProduct; onOpen(): void; onAdd(): void; cod: boolean }) {
  const d = pct(p);
  return (
    <article className="ma-card">
      <button className="ma-card-open" onClick={onOpen} aria-label={p.name}>
        <div className="ma-card-img"><Pic p={p} />{d > 0 ? <span className="ma-off">-{d}%</span> : null}</div>
        <h3>{p.name}</h3>
        <div className="ma-price"><b>{formatKz(p.grossPrice)}</b>{d > 0 && p.listPrice ? <s>{formatKz(p.listPrice)}</s> : null}</div>
        <div className="ma-tags">
          {cod ? <span>Pagamento na entrega</span> : null}
          {!p.inStock && !p.madeToOrder ? <span className="ma-tag-out">Esgotado</span> : null}
        </div>
      </button>
      <button className="ma-card-add" onClick={onAdd} disabled={!p.inStock && !p.madeToOrder} aria-label="Adicionar ao carrinho"><I d={P.cart} size={18} /></button>
    </article>
  );
}

function useCountdown(endsAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!endsAt) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [endsAt]);
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(Math.floor(s / 3600))}:${z(Math.floor((s % 3600) / 60))}:${z(s % 60)}`;
}

function Shelf({ title, items, render, action }: { title: React.ReactNode; items: CatalogProduct[]; render(p: CatalogProduct): React.ReactNode; action?: React.ReactNode }) {
  if (!items.length) return null;
  return (
    <section className="ma-shelf">
      <header><h2>{title}</h2>{action}</header>
      <div className="ma-grid">{items.map((p) => <React.Fragment key={p.code}>{render(p)}</React.Fragment>)}</div>
    </section>
  );
}

/* ───────────────────────── aplicação ───────────────────────── */
export function MembersApp() {
  const { code, data, cart, addToCart, setQty, removeFromCart, clearCart } = useStore();
  const session = useCustomer(code);
  const brand = BRAND;
  const [member, setMember] = useState<Membership | null>(null);
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [view, setView] = useState<View>({ name: 'home' });
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const token = session?.token ?? '';
  const go = useCallback((v: View) => { setView(v); window.scrollTo({ top: 0 }); }, []);
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2200); }, []);

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

  // Catálogo reservado (só associados aprovados) e atualização em segundo plano.
  useEffect(() => {
    if (member !== 'APPROVED' || !token) return;
    let alive = true;
    const load = () => api.membersCatalog(code, token).then((r) => { if (alive) setProducts(r.products); })
      // Acesso retirado pelo gestor: volta a perguntar o estado e fecha a loja.
      .catch((e) => { if (e instanceof ApiError && (e.status === 400 || e.status === 403)) api.myMembership(code, token).then((m) => { if (alive) setMember(m.status); }).catch(() => undefined); });
    void load();
    const t = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, [code, token, member]);

  const cats = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter((c): c is string => !!c))).sort(), [products]);

  if (!session) return <LoginScreen code={code} brand={brand} />;
  if (member === null) return <div className="ma-root ma-boot" aria-busy="true"><Mark size={52} /></div>;
  if (member !== 'APPROVED') {
    return (
      <MembershipScreen status={member} brand={brand} busy={busy}
        onRequest={(note) => { setBusy(true); api.requestMembership(code, token, note).then((r) => setMember(r.status)).catch(() => undefined).finally(() => setBusy(false)); }}
        onLogout={() => clearSession(code)} />
    );
  }

  const cod = (data?.paymentMethods ?? []).some((m) => m.type === 'CASH');
  const count = cartCount(cart);
  const open = (p: CatalogProduct) => go({ name: 'product', code: p.code });
  const add = (p: CatalogProduct, qty = 1) => { addToCart(p, qty); flash('Adicionado ao carrinho'); };
  const card = (p: CatalogProduct) => <Card p={p} cod={cod} onOpen={() => open(p)} onAdd={() => add(p)} />;

  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); go({ name: 'search', q: q.trim() }); };

  let body: React.ReactNode;
  if (view.name === 'home') body = <Home products={products} card={card} go={go} />;
  else if (view.name === 'search') body = <Search products={products} view={view} card={card} />;
  else if (view.name === 'product') body = <Product products={products} code={view.code} cod={cod} onAdd={add} onBuy={(p, n) => { addToCart(p, n); go({ name: 'cart' }); }} card={card} />;
  else if (view.name === 'cart') body = <CartView cart={cart} setQty={setQty} remove={removeFromCart} onNext={() => go({ name: 'checkout' })} onBack={() => go({ name: 'home' })} />;
  else if (view.name === 'checkout') body = <div className="ma-embed"><Checkout onBack={() => go({ name: 'cart' })} onDone={(result, method) => { clearCart(); go({ name: 'done', result, method }); }} /></div>;
  else if (view.name === 'done') body = <div className="ma-embed"><Confirmation order={view.result} method={view.method} onTrack={() => go({ name: 'track', id: view.result.id })} onContinue={() => go({ name: 'home' })} /></div>;
  else if (view.name === 'track') body = <div className="ma-embed"><Track orderId={view.id} onBack={() => go({ name: 'account', tab: 'orders' })} /></div>;
  else body = <Account code={code} token={token} tab={view.tab} go={go} email={session.customer.email} name={session.customer.name} />;


  return (
    <div className="ma-root">
      <header className="ma-top">
        <div className="ma-top-in">
          {view.name !== 'home' ? <button className="ma-ic ma-back" onClick={() => go({ name: 'home' })} aria-label="Início"><I d={P.back} /></button> : null}
          <button className="ma-logo" onClick={() => go({ name: 'home' })} aria-label={brand}><Mark /><span>{brand}</span></button>
          <form className="ma-search" onSubmit={submitSearch} role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produtos…" aria-label="Pesquisar" />
            <button aria-label="Pesquisar"><I d={P.search} size={18} /></button>
          </form>
          <button className="ma-ic" onClick={() => go({ name: 'account', tab: 'orders' })} aria-label="Conta"><I d={P.user} /></button>
          <button className="ma-ic ma-cartbtn" onClick={() => go({ name: 'cart' })} aria-label="Carrinho"><I d={P.cart} />{count > 0 ? <i>{count > 99 ? '99+' : count}</i> : null}</button>
        </div>
        {cats.length ? (
          <nav className="ma-cats" aria-label="Categorias">
            {cats.map((c) => <button key={c} onClick={() => go({ name: 'search', q: '', cat: c })}>{c}</button>)}
          </nav>
        ) : null}
      </header>
      <main className="ma-main">{body}</main>
      {toast ? <div className="ma-toast" role="status"><I d={P.check} size={16} /> {toast}</div> : null}
      <footer className="ma-foot"><span>{brand}</span>{(data?.paymentMethods ?? []).map((m) => <span key={m.id} className="ma-chip">{m.label}</span>)}</footer>
    </div>
  );
}

/* ───────────────────────── início ───────────────────────── */
function Home({ products, card, go }: { products: CatalogProduct[]; card(p: CatalogProduct): React.ReactNode; go(v: View): void }) {
  const flash = products.filter((p) => pct(p) > 0).sort((a, b) => pct(b) - pct(a));
  const ends = flash.map((p) => p.promo?.endsAt).filter((e): e is string => !!e).sort()[0] ?? null;
  const left = useCountdown(ends);
  const top = [...products].filter((p) => (p.sold ?? 0) > 0).sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0)).slice(0, 12);
  const rest = products.filter((p) => !flash.includes(p)).slice(0, 36);
  if (!products.length) return <div className="ma-empty">Sem produtos</div>;
  return (
    <>
      {flash.length ? (
        <section className="ma-flash">
          <header>
            <h2><I d={P.bolt} /> Oferta relâmpago</h2>
            {left ? <span className="ma-timer">{left}</span> : null}
            <button className="ma-link" onClick={() => go({ name: 'search', q: '', promo: true })}>Ver tudo</button>
          </header>
          <div className="ma-row">{flash.slice(0, 12).map((p) => <div key={p.code} className="ma-row-i">{card(p)}</div>)}</div>
        </section>
      ) : null}
      <Shelf title="Destaque" items={top} render={card} />
      <Shelf title="Descobertas do dia" items={rest} render={card} />
    </>
  );
}

/* ───────────────────────── pesquisa com filtros ───────────────────────── */
function Search({ products, view, card }: { products: CatalogProduct[]; view: Extract<View, { name: 'search' }>; card(p: CatalogProduct): React.ReactNode }) {
  const [cat, setCat] = useState(view.cat ?? '');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [promo, setPromo] = useState(!!view.promo);
  const [stock, setStock] = useState(false);
  const [sort, setSort] = useState<'rel' | 'asc' | 'desc' | 'sold'>('rel');
  const [panel, setPanel] = useState(false);
  useEffect(() => { setCat(view.cat ?? ''); setPromo(!!view.promo); }, [view.cat, view.promo]);

  const cats = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter((c): c is string => !!c))).sort(), [products]);
  const list = useMemo(() => {
    const term = view.q.trim().toLowerCase();
    let r = products.filter((p) =>
      (!term || p.name.toLowerCase().includes(term) || (p.description ?? '').toLowerCase().includes(term) || p.code.toLowerCase().includes(term)) &&
      (!cat || p.category === cat) &&
      (!min || p.grossPrice >= Number(min)) && (!max || p.grossPrice <= Number(max)) &&
      (!promo || pct(p) > 0) && (!stock || p.inStock || p.madeToOrder));
    if (sort === 'asc') r = [...r].sort((a, b) => a.grossPrice - b.grossPrice);
    else if (sort === 'desc') r = [...r].sort((a, b) => b.grossPrice - a.grossPrice);
    else if (sort === 'sold') r = [...r].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0));
    return r;
  }, [products, view.q, cat, min, max, promo, stock, sort]);

  return (
    <section className="ma-search-page">
      <header className="ma-sp-head">
        <h1>{view.q ? `${list.length} resultados para “${view.q}”` : cat || `${list.length} produtos`}</h1>
        <div className="ma-sp-tools">
          <button className="ma-btn" onClick={() => setPanel((v) => !v)} aria-expanded={panel}><I d={P.filter} size={16} /> Filtros</button>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar por">
            <option value="rel">Mais relevantes</option><option value="sold">Mais vendidos</option>
            <option value="asc">Menor preço</option><option value="desc">Maior preço</option>
          </select>
        </div>
      </header>
      <div className={`ma-filters${panel ? ' open' : ''}`}>
        <label className="ma-f"><span>Categoria</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="ma-f"><span>Preço mínimo</span><input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} /></label>
        <label className="ma-f"><span>Preço máximo</span><input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} /></label>
        <label className="ma-chk"><input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} /> Com desconto</label>
        <label className="ma-chk"><input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} /> Disponível</label>
      </div>
      {list.length ? <div className="ma-grid">{list.map((p) => <React.Fragment key={p.code}>{card(p)}</React.Fragment>)}</div> : <div className="ma-empty">Sem resultados</div>}
    </section>
  );
}

/* ───────────────────────── produto ───────────────────────── */
function Product({ products, code, cod, onAdd, onBuy, card }: {
  products: CatalogProduct[]; code: string; cod: boolean;
  onAdd(p: CatalogProduct, qty: number): void; onBuy(p: CatalogProduct, qty: number): void; card(p: CatalogProduct): React.ReactNode;
}) {
  const p = products.find((x) => x.code === code);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  useEffect(() => { setImg(0); setQty(1); }, [code]);
  if (!p) return <div className="ma-empty">Produto indisponível</div>;
  const pics = [p.imageUrl, ...(p.gallery ?? [])].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  const d = pct(p);
  const can = p.inStock || !!p.madeToOrder;
  const max = p.madeToOrder || p.stockQty == null ? 99 : Math.max(1, Math.floor(p.stockQty));
  const similar = products.filter((x) => x.code !== p.code && x.category && x.category === p.category).slice(0, 12);
  return (
    <>
      <section className="ma-prod">
        <div className="ma-gal">
          <div className="ma-gal-main">{pics.length ? <img src={pics[img] ?? pics[0]} alt={p.name} /> : <Pic p={p} />}</div>
          {pics.length > 1 ? <div className="ma-thumbs">{pics.map((u, i) => <button key={u} className={i === img ? 'on' : ''} onClick={() => setImg(i)} aria-label={`Imagem ${i + 1}`}><img src={u} alt="" loading="lazy" /></button>)}</div> : null}
        </div>
        <div className="ma-info">
          <h1>{p.name}</h1>
          {p.rating ? <div className="ma-stars" aria-label={`${p.rating} de 5`}>{'★'.repeat(Math.round(p.rating))}{'☆'.repeat(5 - Math.round(p.rating))} <small>({p.reviews ?? 0})</small></div> : null}
          <div className="ma-price ma-price-lg"><b>{formatKz(p.grossPrice)}</b>{d > 0 && p.listPrice ? <><s>{formatKz(p.listPrice)}</s><span className="ma-off">-{d}%</span></> : null}</div>
          {d > 0 && p.listPrice ? <div className="ma-save">Poupe {formatKz(p.listPrice - p.grossPrice)}</div> : null}
          <div className="ma-tags">{cod ? <span>Pagamento na entrega</span> : null}{!can ? <span className="ma-tag-out">Esgotado</span> : null}</div>
          <div className="ma-qty" role="group" aria-label="Quantidade">
            <button onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="Menos">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((n) => Math.min(max, n + 1))} aria-label="Mais">+</button>
          </div>
          <div className="ma-actions">
            <button className="ma-btn ma-btn-soft" disabled={!can} onClick={() => onAdd(p, qty)}>Adicionar ao carrinho</button>
            <button className="ma-btn ma-btn-primary" disabled={!can} onClick={() => onBuy(p, qty)}>Comprar</button>
          </div>
          {p.description ? <div className="ma-desc"><h3>Detalhes</h3><p>{p.description}</p></div> : null}
        </div>
      </section>
      <Shelf title="Produtos similares" items={similar} render={card} />
    </>
  );
}

/* ───────────────────────── carrinho ───────────────────────── */
function CartView({ cart, setQty, remove, onNext, onBack }: {
  cart: ReturnType<typeof useStore>['cart']; setQty(code: string, q: number): void; remove(code: string): void; onNext(): void; onBack(): void;
}) {
  if (!cart.length) return <div className="ma-empty"><p>Carrinho vazio</p><button className="ma-btn ma-btn-primary" onClick={onBack}>Ver produtos</button></div>;
  const full = cart.reduce((s, l) => s + (l.product.listPrice && l.product.listPrice > l.product.grossPrice ? l.product.listPrice : l.product.grossPrice) * l.quantity, 0);
  const total = cartTotal(cart);
  return (
    <section className="ma-cart">
      <ol className="ma-steps"><li className="on">1. Carrinho</li><li>2. Pagamento</li></ol>
      <div className="ma-cart-grid">
        <ul className="ma-lines">
          {cart.map((l) => (
            <li key={l.product.code}>
              <Pic p={l.product} className="ma-line-pic" />
              <div className="ma-line-in">
                <h3>{l.product.name}</h3>
                <div className="ma-price"><b>{formatKz(l.product.grossPrice)}</b> <small>× {l.quantity}</small></div>
                <div className="ma-qty sm">
                  <button onClick={() => setQty(l.product.code, l.quantity - 1)} aria-label="Menos">−</button><span>{l.quantity}</span><button onClick={() => setQty(l.product.code, l.quantity + 1)} aria-label="Mais">+</button>
                </div>
              </div>
              <button className="ma-ic" onClick={() => remove(l.product.code)} aria-label="Remover"><I d={P.trash} size={18} /></button>
            </li>
          ))}
        </ul>
        <aside className="ma-sum">
          {full > total ? <div><span>Preço cheio</span><s>{formatKz(full)}</s></div> : null}
          {full > total ? <div className="ma-disc"><span>Desconto</span><b>- {formatKz(full - total)}</b></div> : null}
          <div className="ma-sum-t"><span>Subtotal</span><b>{formatKz(total)}</b></div>
          <button className="ma-btn ma-btn-primary ma-block" onClick={onNext}>Continuar com a compra</button>
        </aside>
      </div>
    </section>
  );
}

/* ───────────────────────── conta ───────────────────────── */
function Account({ code, token, tab, go, email, name }: {
  code: string; token: string; tab: 'orders' | 'coupons' | 'profile'; go(v: View): void; email: string; name: string;
}) {
  const tabs: Array<['orders' | 'coupons' | 'profile', string]> = [['orders', 'Minhas compras'], ['coupons', 'Meus cupões'], ['profile', 'Perfil e endereço']];
  return (
    <section className="ma-acc">
      <header className="ma-acc-head">
        <div className="ma-avatar" aria-hidden="true">{(name || email).slice(0, 1).toUpperCase()}</div>
        <div><h1>{name}</h1>{shownEmail(email) ? <small>{shownEmail(email)}</small> : null}</div>
        <button className="ma-btn" onClick={() => clearSession(code)}><I d={P.out} size={16} /> Terminar sessão</button>
      </header>
      <nav className="ma-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go({ name: 'account', tab: k })}>{l}</button>)}</nav>
      {tab === 'orders' ? <Orders code={code} token={token} go={go} /> : tab === 'coupons' ? <Coupons code={code} /> : <Profile code={code} token={token} />}
    </section>
  );
}

const STATUS: Record<string, string> = { PENDING: 'Pendente', PAID: 'Pago', SHIPPED: 'Enviado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado' };

function Orders({ code, token, go }: { code: string; token: string; go(v: View): void }) {
  const [rows, setRows] = useState<MyOrderRow[] | null>(null);
  useEffect(() => { api.myOrders(code, token).then(setRows).catch(() => setRows([])); }, [code, token]);
  if (rows === null) return <div className="ma-empty" aria-busy="true" />;
  if (!rows.length) return <div className="ma-empty">Sem encomendas</div>;
  return (
    <ul className="ma-orders">
      {rows.map((o) => (
        <li key={o.id}><button onClick={() => go({ name: 'track', id: o.id })}>
          <b>{o.order_number}</b><span>{formatDateTime(o.created_at)}</span>
          <span className={`ma-pill ma-st-${o.status}`}>{STATUS[o.status] ?? o.status}</span><strong>{formatKz(o.gross_total)}</strong>
        </button></li>
      ))}
    </ul>
  );
}

function Coupons({ code }: { code: string }) {
  const [rows, setRows] = useState<PublicCoupon[] | null>(null);
  useEffect(() => { api.coupons(code).then(setRows).catch(() => setRows([])); }, [code]);
  if (rows === null) return <div className="ma-empty" aria-busy="true" />;
  if (!rows.length) return <div className="ma-empty">Sem cupões</div>;
  return (
    <ul className="ma-coupons">
      {rows.map((c) => (
        <li key={c.code}><b>{c.code}</b><span>{c.type === 'PERCENT' ? `${c.value}%` : formatKz(c.value)}</span>{c.minOrder ? <small>Mín. {formatKz(c.minOrder)}</small> : null}{c.endsAt ? <small>até {formatDateTime(c.endsAt)}</small> : null}</li>
      ))}
    </ul>
  );
}

function Profile({ code, token }: { code: string; token: string }) {
  const [p, setP] = useState<{ name: string; phone: string; province: string; municipality: string; neighborhood: string; address: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.myProfile(code, token).then((r) => setP({ name: r.name ?? '', phone: r.phone ?? '', province: r.province ?? '', municipality: r.municipality ?? '', neighborhood: r.neighborhood ?? '', address: r.address ?? '' })).catch(() => setP({ name: '', phone: '', province: '', municipality: '', neighborhood: '', address: '' }));
  }, [code, token]);
  if (!p) return <div className="ma-empty" aria-busy="true" />;
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api.updateProfile(code, token, p); setMsg('Guardado'); } catch (er) { setMsg(er instanceof ApiError ? er.message : 'Não foi possível guardar'); }
    finally { setBusy(false); }
  };
  return (
    <form className="ma-profile" onSubmit={(e) => void save(e)}>
      <label className="ma-f"><span>Nome</span><input value={p.name} onChange={set('name')} autoComplete="name" /></label>
      <label className="ma-f"><span>Telefone</span><input value={p.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" /></label>
      <label className="ma-f"><span>Província</span><input value={p.province} onChange={set('province')} /></label>
      <label className="ma-f"><span>Município</span><input value={p.municipality} onChange={set('municipality')} /></label>
      <label className="ma-f"><span>Rua ou bairro</span><input value={p.neighborhood} onChange={set('neighborhood')} /></label>
      <label className="ma-f"><span>Endereço</span><input value={p.address} onChange={set('address')} /></label>
      {msg ? <div className={msg === 'Guardado' ? 'ma-ok' : 'ma-err'} role="status">{msg}</div> : null}
      <button className="ma-btn ma-btn-primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
    </form>
  );
}
