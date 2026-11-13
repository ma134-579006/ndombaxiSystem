import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../members/members.css';
import './kikolo.css';
import { ApiError } from '../api/client';
import { API_URL, PUBLIC_ORIGIN } from '../config';
import type { CatalogProduct } from '../api/types';
import { formatDateTime } from '../format';
import { readFileProgress } from '../transfer';
import { BRAND, I, KLoader, Mark, P, Pic, kz, useInfinite, useReveal } from '../members/parts';
import { Search, type SearchState } from '../members/Search';
import { Messages, NotesBell } from './Inbox';
import { PostEditor } from './PostEditor';
import { Claims, ProductSocial } from './Trust';
import { CodeBox, TwoFaCard, codeAsk, leftText, useNow, type CodeAsk } from './Security';
import { CartDrawer, Checkout, ORDER_LABEL, Orders, cart, useCart } from './Shop';
import { banners as loadBanners, kw, session, shareLink, type Affiliation, type Associate, type Dashboard, type KBanner, type Listing, type PayoutAccount } from './api';

/* LPS Kwanza — marketplace de associados com a estrutura do Kikolo Online (cabeçalho por cima
   do anúncio, carrosséis, faixa de ofertas, categorias, descobertas do dia, página de produto com
   barra de compra fixa, carrinho em gaveta, área do associado com menu lateral). Marca, cores,
   imagens e textos são do LPS Kwanza. */

/** Produto do marketplace no formato dos cartões (código = empresa::produto). */
type MP = CatalogProduct & { listing: Listing };
const toMP = (l: Listing): MP => ({
  code: `${l.companyCode}::${l.productCode}${l.associate ? `::${l.associate.code}` : ''}`, name: l.name, description: l.description, ivaCode: '' as never, netPrice: l.grossPrice, grossPrice: l.grossPrice,
  inStock: l.inStock, imageUrl: l.imageUrl, gallery: l.gallery, category: l.category, listPrice: l.listPrice ?? undefined,
  promo: l.listPrice && l.listPrice > l.grossPrice ? { name: 'Promoção', percent: Math.round((1 - l.grossPrice / l.listPrice) * 100), endsAt: null } : undefined,
  sold: l.sold, views: l.views, listing: l,
});
const com = (l: Listing, pct?: number) => Math.round(l.grossPrice * (pct ?? l.commissionPct)) / 100;
const off = (l: Listing) => (l.listPrice && l.listPrice > l.grossPrice ? Math.round((1 - l.grossPrice / l.listPrice) * 100) : 0);

type Route =
  | { n: 'home' } | { n: 'search'; s: SearchState } | { n: 'product'; c: string; p: string; a?: string }
  | { n: 'login' } | { n: 'register' } | { n: 'recover' } | { n: 'claims' } | { n: 'cart' } | { n: 'orders' }
  | { n: 'panel' } | { n: 'sales' } | { n: 'market' } | { n: 'affs' } | { n: 'withdraw' } | { n: 'accounts' } | { n: 'profile' } | { n: 'msgs'; c?: string };
const parse = (h: string): Route => {
  const [path, qs] = h.replace(/^#\/?/, '').split('?'); const s = path.split('/').filter(Boolean).map(decodeURIComponent); const q = new URLSearchParams(qs ?? '');
  switch (s[0]) {
    case 'busca': return { n: 'search', s: { q: q.get('q') ?? '', cat: q.get('cat') ?? undefined, promo: q.get('promo') === '1' } };
    case 'p': return s[1] && s[2] ? { n: 'product', c: s[1], p: s[2], a: s[3] || undefined } : { n: 'home' };
    case 'reclamacoes': return { n: 'claims' };
    case 'carrinho': return { n: 'cart' }; case 'compras': return { n: 'orders' };
    case 'entrar': return { n: 'login' }; case 'registar': return { n: 'register' }; case 'recuperar': return { n: 'recover' };
    case 'painel': return { n: 'panel' }; case 'vendas': return { n: 'sales' }; case 'mercado': return { n: 'market' }; case 'afiliacoes': return { n: 'affs' };
    case 'saques': return { n: 'withdraw' }; case 'contas': return { n: 'accounts' }; case 'perfil': return { n: 'profile' };
    case 'mensagens': return { n: 'msgs', c: s[1] || undefined };
    default: return { n: 'home' };
  }
};
const hashOf = (r: Route): string => {
  switch (r.n) {
    case 'search': { const q = new URLSearchParams(); if (r.s.q) q.set('q', r.s.q); if (r.s.cat) q.set('cat', r.s.cat); if (r.s.promo) q.set('promo', '1'); const x = q.toString(); return `#/busca${x ? `?${x}` : ''}`; }
    case 'product': return `#/p/${encodeURIComponent(r.c)}/${encodeURIComponent(r.p)}${r.a ? `/${encodeURIComponent(r.a)}` : ''}`;
    case 'claims': return '#/reclamacoes';
    case 'cart': return '#/carrinho'; case 'orders': return '#/compras';
    case 'login': return '#/entrar'; case 'register': return '#/registar'; case 'recover': return '#/recuperar';
    case 'panel': return '#/painel'; case 'sales': return '#/vendas'; case 'market': return '#/mercado'; case 'affs': return '#/afiliacoes'; case 'withdraw': return '#/saques'; case 'accounts': return '#/contas'; case 'profile': return '#/perfil';
    case 'msgs': return r.c ? `#/mensagens/${encodeURIComponent(r.c)}` : '#/mensagens';
    default: return '#/';
  }
};
const PRIVATE = new Set(['panel', 'sales', 'market', 'affs', 'withdraw', 'accounts', 'profile', 'msgs']);
const bannerSrc = (b: KBanner) => (b.image ? `${API_URL}${b.image}` : null);

export function KwanzaApp() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [sess, setSess] = useState(() => session.get());
  const [list, setList] = useState<Listing[] | null>(null);
  const [ads, setAds] = useState<KBanner[]>([]);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ id: number; t: string } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { const on = () => setRoute(parse(location.hash)); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => { const on = () => setSess(session.get()); window.addEventListener('kwanza:session', on); return () => window.removeEventListener('kwanza:session', on); }, []);
  useEffect(() => { const on = () => setScrolled(window.scrollY > 24); on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on); }, []);
  // Altura real do cabeçalho: o anúncio do início sobe por baixo dele (como no Kikolo).
  useEffect(() => {
    const h = document.querySelector('.kk-head'); if (!h) return;
    const set = () => document.documentElement.style.setProperty('--kk-head', `${Math.round(h.getBoundingClientRect().height)}px`);
    set(); const ro = new ResizeObserver(set); ro.observe(h); return () => ro.disconnect();
  });
  // Associados veem todos os produtos; clientes sem sessão só os que já têm associado.
  useEffect(() => {
    setList(null);
    kw.market(sess?.token).then(setList).catch(() => setList([]));
    // Tempo real: preços, stock e publicações voltam a ser lidos sozinhos (sem recarregar a página).
    const again = () => { if (document.visibilityState === 'visible') kw.market(sess?.token).then(setList).catch(() => undefined); };
    const t = window.setInterval(again, 10_000);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); };
  }, [sess?.token]);
  // Mensagens por ler (associado), em tempo real.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!sess) { setUnread(0); return; }
    const get = () => { if (document.visibilityState === 'visible') kw.chats(sess.token).then((c) => setUnread(c.reduce((a, x) => a + (x.unread || 0), 0))).catch(() => undefined); };
    get(); const t = window.setInterval(get, 15_000); window.addEventListener('focus', get);
    return () => { window.clearInterval(t); window.removeEventListener('focus', get); };
  }, [sess?.token]);
  // Anúncios das empresas (geridos no painel de cada empresa).
  useEffect(() => {
    const get = () => loadBanners().then(setAds).catch(() => undefined);
    void get(); const t = window.setInterval(get, 60_000); return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    const l = route.n === 'product' ? list?.find((x) => x.companyCode === route.c && x.productCode === route.p && (!route.a || x.associate?.code === route.a)) : null;
    document.title = l ? `${l.name} — LPS Kwanza` : 'LPS Kwanza — Marketplace de associados';
  }, [route, list]);
  const go = useCallback((r: Route) => { const h = hashOf(r); setDrawer(false); if (location.hash === h) setRoute(r); else location.hash = h; window.scrollTo({ top: 0 }); }, []);
  const flash = useCallback((t: string) => { const id = Date.now(); setToast({ id, t }); window.setTimeout(() => setToast((x) => (x?.id === id ? null : x)), 2600); }, []);
  const products = useMemo(() => (list ?? []).map(toMP), [list]);
  const cats = useMemo(() => { const m = new Map<string, { n: number; img: MP }>(); for (const p of products) if (p.category) { const c = m.get(p.category); if (c) c.n++; else m.set(p.category, { n: 1, img: p }); } return [...m.entries()].sort((a, b) => b[1].n - a[1].n); }, [products]);
  const open = useCallback((p: CatalogProduct) => { const [c, pc, a] = p.code.split('::'); go({ n: 'product', c, p: pc, a }); }, [go]);
  const card = (p: CatalogProduct, hot?: boolean) => <KCard p={p as MP} hot={hot} onOpen={() => open(p)} />;
  const adGo = useCallback((b: KBanner) => {
    if (!b.link) { go({ n: 'search', s: { q: b.companyName } }); return; }
    if (b.link.kind === 'url') { window.open(b.link.value, '_blank', 'noopener'); return; }
    if (b.link.kind === 'product') go({ n: 'product', c: b.companyCode, p: b.link.value });
    else go({ n: 'search', s: { q: b.link.value } });
  }, [go]);
  // Sessão expirada → volta a entrar.
  useEffect(() => { if (sess) kw.me(sess.token).catch((e) => { if (e instanceof ApiError && e.status === 401) session.clear(); }); }, [sess?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const needLogin = PRIVATE.has(route.n) && !sess;
  let body: React.ReactNode;
  if (needLogin || route.n === 'login') body = <Login onDone={() => go(route.n === 'login' ? { n: 'panel' } : route)} go={go} />;
  else if (route.n === 'register') body = <Register onDone={() => go({ n: 'panel' })} go={go} />;
  else if (route.n === 'recover') body = <Recover go={go} flash={flash} />;
  else if (route.n === 'cart') body = <Checkout go={go} flash={flash} />;
  else if (route.n === 'orders') body = <Orders go={go} />;
  else if (route.n === 'claims') body = <div className="kk-page"><div className="kk-wrap"><Claims companies={[...new Map((list ?? []).map((l) => [l.companyCode, { code: l.companyCode, name: l.companyName }])).values()]} /></div></div>;
  else if (route.n === 'search') body = list === null ? <KLoader overlay={false} /> : <div className="kk-page"><div className="kk-wrap"><Search products={products} state={route.s} card={card} onState={(s) => go({ n: 'search', s })} /></div></div>;
  else if (route.n === 'product') body = <ProductRoute key={`${route.c}/${route.p}/${route.a ?? ''}`} route={route} list={list} sess={sess} go={go} flash={flash} card={card} products={products} />;
  else if (PRIVATE.has(route.n) && sess) body = <Area route={route.n as AreaTab} chat={route.n === 'msgs' ? route.c : undefined} go={go} token={sess.token} me={sess.associate} flash={flash} products={products} ads={ads} />;
  else body = <Home products={list === null ? null : products} cats={cats} ads={ads} adGo={adGo} go={go} card={card} buyer={!sess} />;

  // Entrar / criar conta / recuperar: UM ecrã só, sem barra nem rodapé e sem scroll da página.
  if (needLogin || route.n === 'login' || route.n === 'register' || route.n === 'recover') {
    return (
      <div className="kw-root kw-authscreen">
        <div className="kw-as-art" aria-hidden="true"><img src="/kwanza-auth.svg" alt="" /></div>
        <main className="kw-as-main">
          <button className="kw-as-back" onClick={() => go({ n: 'home' })} aria-label="Voltar ao marketplace"><I d={P.back} size={20} /></button>
          {body}
        </main>
        {toast ? <div key={toast.id} className="kw-toast" role="status"><span className="kw-toast-ic"><I d={P.check} size={16} /></span>{toast.t}<i className="kw-toast-bar" /></div> : null}
      </div>
    );
  }

  // No início o cabeçalho fica por cima do anúncio (transparente) até se fazer scroll.
  const overHero = route.n === 'home' && list !== null && list.length > 0;
  return (
    <div className="kw-root kk">
      <Header sess={sess} go={go} q={q} setQ={setQ} clear={overHero && !scrolled} cats={cats} showCats={route.n !== 'home'} onCart={() => setDrawer(true)} unread={unread} />
      <main className={`kk-main${overHero ? ' under' : ''}`} key={hashOf(route)}>{body}</main>
      {toast ? <div key={toast.id} className="kw-toast" role="status"><span className="kw-toast-ic"><I d={P.check} size={16} /></span>{toast.t}<i className="kw-toast-bar" /></div> : null}
      {drawer ? <CartDrawer onClose={() => setDrawer(false)} onCart={() => go({ n: 'cart' })} /> : null}
      {route.n !== 'msgs' ? <MsgFab sess={!!sess} unread={unread} go={go} lifted={route.n === 'product'} /> : null}
      <Footer go={go} sess={!!sess} />
    </div>
  );
}

/* ───────────── cabeçalho (faixa de topo + logótipo, pesquisa e carrinho) ───────────── */
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', on); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}
function Drop({ label, icon, children, align = 'right', className = '' }: { label: React.ReactNode; icon?: string; children(close: () => void): React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  return (
    <div className={`kk-drop ${className}`} ref={ref}>
      <button type="button" className="kk-strip-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{icon ? <I d={icon} size={17} /> : null}{label}</button>
      {open ? <div className={`kk-menu ${align}`} role="menu">{children(close)}</div> : null}
    </div>
  );
}

function Header({ sess, go, q, setQ, clear, cats, showCats, onCart, unread }: {
  sess: ReturnType<typeof session.get>; go(r: Route): void; q: string; setQ(v: string): void; clear: boolean;
  cats: Array<[string, { n: number; img: MP }]>; showCats: boolean; onCart(): void; unread: number;
}) {
  const n = useCart().reduce((s, i) => s + i.qty, 0);
  return (
    <header className={`kk-head${clear ? ' clear' : ''}`}>
      <div className="kk-strip">
        <div className="kk-wrap kk-strip-in">
          <span className="kk-strip-l">
            <button type="button" className="kk-strip-btn" onClick={() => go({ n: sess ? 'panel' : 'register' })}>Central do Associado</button>
            <button type="button" className="kk-strip-btn" onClick={() => go({ n: 'orders' })}>Minhas compras</button>
          </span>
          <span className="kk-strip-r">
            {sess ? <span className="kk-bell"><NotesBell token={sess.token} /><span className="kk-hide-sm">Notificações</span></span> : null}
            <Drop icon={P.help} label={<span className="kk-hide-xs">Ajuda</span>}>{(close) => <>
              <button role="menuitem" onClick={() => { close(); go({ n: 'orders' }); }}>Minhas compras</button>
              <button role="menuitem" onClick={() => { close(); go({ n: 'claims' }); }}>Reclamações</button>
              <button role="menuitem" onClick={() => { close(); go({ n: 'claims' }); }}>Devoluções e reembolsos</button>
            </>}</Drop>
            <Drop icon={P.globe} label={<><span className="kk-hide-xs">Português (AO)</span><span className="kk-caret" aria-hidden="true">▾</span></>}>{(close) => <button role="menuitem" className="on" onClick={close}>Português (AO)</button>}</Drop>
            {sess ? (
              <Drop className="kk-me" label={<span className="kk-avatar">{sess.associate.photoUrl ? <img src={sess.associate.photoUrl} alt="" /> : <b>{sess.associate.name.slice(0, 1).toUpperCase()}</b>}</span>}>{(close) => <>
                <button role="menuitem" onClick={() => { close(); go({ n: 'panel' }); }}>Minha conta</button>
                <button role="menuitem" onClick={() => { close(); go({ n: 'sales' }); }}>Minhas vendas</button>
                <button role="menuitem" onClick={() => { close(); go({ n: 'msgs' }); }}>Mensagens</button>
                <button role="menuitem" onClick={() => { close(); go({ n: 'orders' }); }}>Minhas compras</button>
                <button role="menuitem" onClick={() => { close(); session.clear(); go({ n: 'home' }); }}>Sair</button>
              </>}</Drop>
            ) : <button type="button" className="kk-strip-btn" onClick={() => go({ n: 'login' })}><I d={P.user} size={17} /> Entrar</button>}
          </span>
        </div>
      </div>
      <div className="kk-wrap kk-bar">
        <button className="kk-logo" onClick={() => go({ n: 'home' })} aria-label={BRAND}><Mark size={42} /><span className="kk-logo-txt"><b>LPS</b> Kwanza</span></button>
        <form className="kk-search" role="search" onSubmit={(e) => { e.preventDefault(); go({ n: 'search', s: { q: q.trim() } }); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produtos, marcas e muito mais…" aria-label="Pesquisar" />
          <button aria-label="Pesquisar"><I d={P.search} size={18} /></button>
        </form>
        {sess ? <button type="button" className="kk-cart" onClick={() => go({ n: 'msgs' })} aria-label={`Mensagens${unread ? ` (${unread} por ler)` : ''}`}><I d={P.chat} size={26} />{unread ? <em>{unread > 99 ? '99+' : unread}</em> : null}</button> : null}
        <button type="button" className="kk-cart" onClick={onCart} aria-label={`Carrinho${n ? ` (${n})` : ''}`}><I d={P.cart} size={27} />{n ? <em>{n > 99 ? '99+' : n}</em> : null}</button>
      </div>
      {showCats && cats.length ? (
        <div className="kk-catbar"><div className="kk-wrap">
          <Drop align="left" className="kk-catdrop" label={<><I d={P.grid} size={16} /> Categorias <I d={P.next} size={14} /></>}>{(close) => cats.map(([name, c]) => (
            <button key={name} role="menuitem" onClick={() => { close(); go({ n: 'search', s: { q: '', cat: name } }); }}><span>{name}</span><small>{c.n}</small></button>
          ))}</Drop>
        </div></div>
      ) : null}
    </header>
  );
}

/* ───────────── botão flutuante de mensagens (como o de conversa do Kikolo) ───────────── */
function MsgFab({ sess, unread, go, lifted }: { sess: boolean; unread: number; go(r: Route): void; lifted: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  return (
    <div className={`kk-fab${lifted ? ' up' : ''}`} ref={ref}>
      {open ? (
        <div className="kk-fab-menu" role="menu">
          <b>LPS Kwanza</b>
          {sess ? <button role="menuitem" onClick={() => { close(); go({ n: 'msgs' }); }}><I d={P.chat} size={18} /> Mensagens com as empresas{unread ? <em>{unread}</em> : null}</button> : null}
          <button role="menuitem" onClick={() => { close(); go({ n: 'orders' }); }}><I d={P.box} size={18} /> Minhas compras</button>
          <button role="menuitem" onClick={() => { close(); go({ n: 'claims' }); }}><I d={P.flag} size={18} /> Reclamações e devoluções</button>
          {!sess ? <button role="menuitem" onClick={() => { close(); go({ n: 'login' }); }}><I d={P.user} size={18} /> Entrar para falar com as empresas</button> : null}
        </div>
      ) : null}
      <button className="kk-fab-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Mensagens${unread ? ` (${unread} por ler)` : ''}`}>
        <I d={open ? P.close : P.chat} size={28} />{unread && !open ? <em>{unread > 99 ? '99+' : unread}</em> : null}
      </button>
    </div>
  );
}

/* ───────────── rodapé ───────────── */
function Footer({ go, sess }: { go(r: Route): void; sess: boolean }) {
  return (
    <footer className="kk-foot">
      <div className="kk-wrap kk-foot-in">
        <div className="kk-foot-brand"><Mark size={70} inverse /><p>© {new Date().getFullYear()} {BRAND} TODOS OS DIREITOS RESERVADOS</p></div>
        <div><h4>LPS Kwanza</h4><button onClick={() => go({ n: 'home' })}>Marketplace</button><button onClick={() => go({ n: 'search', s: { q: '' } })}>Todos os produtos</button><button onClick={() => go({ n: sess ? 'panel' : 'register' })}>Central do Associado</button></div>
        <div><h4>Consumidor</h4><button onClick={() => go({ n: 'orders' })}>Minhas compras</button><button onClick={() => go({ n: 'claims' })}>Reclamações</button><button onClick={() => go({ n: 'claims' })}>Devoluções e reembolsos</button></div>
        <div><h4>Associados</h4><button onClick={() => go({ n: 'market' })}>Mercado de Associados</button><button onClick={() => go({ n: 'withdraw' })}>Transações (Saques)</button><button onClick={() => go({ n: 'profile' })}>Perfil</button></div>
      </div>
    </footer>
  );
}

/* ───────────── cartão de produto ───────────── */
function KCard({ p, onOpen, hot, aff }: { p: MP; onOpen(): void; hot?: boolean; aff?: boolean }) {
  const l = p.listing; const d = off(l);
  return (
    <article className="kk-card">
      <button className="kk-card-img" onClick={onOpen} aria-label={p.name} tabIndex={-1}>
        <Pic p={p} />
        <span className="kk-card-cart" aria-hidden="true"><I d={P.cart} size={15} /></span>
        {(l.views ?? 0) > 0 ? <span className="kk-card-views"><I d={P.eye} size={13} />{l.views}</span> : null}
        {hot ? <span className="kk-card-hot">Em alta</span> : null}
        <span className="kk-card-pay"><I d={P.truck} size={12} />Entrega pela empresa</span>
        {d > 0 ? <span className="kk-card-off">-{d}%</span> : null}
      </button>
      <button className="kk-card-body" onClick={onOpen}>
        <h3>{p.name}</h3>
        {aff ? <>
          {l.affiliation === 'RESTRICTED' ? <span className="kk-card-restr"><I d={P.close} size={13} /> Afiliação Restrita</span> : null}
          <small className="kk-card-k">Comissão de até</small><b className="kk-card-com">{kz(com(l))}</b>
          <small className="kk-card-k">Valor de venda</small><b className="kk-card-val">{kz(l.grossPrice)}</b>
        </> : <>
          {d > 0 && l.listPrice ? <s className="kk-card-old">{kz(l.listPrice)}</s> : null}
          <b className="kk-card-price">{kz(l.grossPrice)}</b>
          <span className="kk-card-ship">{p.inStock ? <><em>Disponível ⚡</em> Pronto para <b>envio</b></> : <em className="out">Esgotado</em>}</span>
        </>}
      </button>
    </article>
  );
}

/* ───────────── prateleira horizontal com setas ───────────── */
function KShelf({ items, render }: { items: MP[]; render(p: MP): React.ReactNode }) {
  const track = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ l: true, r: false });
  const upd = useCallback(() => { const t = track.current; if (!t) return; setEdge({ l: t.scrollLeft <= 4, r: t.scrollLeft + t.clientWidth >= t.scrollWidth - 4 }); }, []);
  useEffect(() => { upd(); }, [items, upd]);
  const move = (dir: number) => { const t = track.current; if (t) t.scrollBy({ left: dir * t.clientWidth * 0.9, behavior: 'smooth' }); };
  return (
    <div className="kk-shelf">
      {!edge.l ? <button className="kk-arrow l" onClick={() => move(-1)} aria-label="Anteriores"><I d={P.back} size={18} /></button> : null}
      <div className="kk-shelf-track" ref={track} onScroll={upd}>{items.map((p) => <div className="kk-shelf-item" key={p.code}>{render(p)}</div>)}</div>
      {!edge.r ? <button className="kk-arrow r" onClick={() => move(1)} aria-label="Seguintes"><I d={P.next} size={18} /></button> : null}
    </div>
  );
}

/* ───────────── carrossel de anúncios (imagem inteira; pontos por baixo) ───────────── */
interface Ad { id: string; image: string | null; title?: string; subtitle?: string | null; cta?: string | null; onClick(): void }
function AdCarousel({ ads, className = '', interval = 4500 }: { ads: Ad[]; className?: string; interval?: number }) {
  const [i, setI] = useState(0); const [paused, setPaused] = useState(false); const touch = useRef<number | null>(null);
  const n = ads.length;
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  useEffect(() => {
    if (n < 2 || paused) return;
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % n), interval); return () => window.clearInterval(t);
  }, [n, paused, interval]);
  if (!n) return null;
  return (
    <div className={`kk-car ${className}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; setPaused(true); }}
      onTouchEnd={(e) => { const s = touch.current; touch.current = null; setPaused(false); if (s == null) return; const dx = e.changedTouches[0].clientX - s; if (Math.abs(dx) > 40) setI((x) => (x + (dx < 0 ? 1 : -1) + n) % n); }}>
      <div className="kk-car-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {ads.map((a, k) => (
          <button key={a.id} className={`kk-ad${a.image ? '' : ' txt'}`} onClick={a.onClick} aria-hidden={k !== i} tabIndex={k === i ? 0 : -1} aria-label={a.title ?? 'Anúncio'}>
            {a.image ? <img src={a.image} alt="" loading={k === 0 ? 'eager' : 'lazy'} /> : null}
            {!a.image ? <span className="kk-ad-txt"><strong>{a.title}</strong>{a.subtitle ? <small>{a.subtitle}</small> : null}{a.cta ? <em>{a.cta}</em> : null}</span> : null}
          </button>
        ))}
      </div>
      {n > 1 ? <div className="kk-car-dots">{ads.map((a, k) => <button key={a.id} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Anúncio ${k + 1}`} />)}</div> : null}
    </div>
  );
}

/* ───────────── início ───────────── */
/** Categorias do marketplace sempre visíveis (como no Kikolo); com produtos, usam a foto de um deles. */
const BASE_CATS: Array<[string, string, string]> = [
  ['Alimentos e Bebidas', '#ffe9d6', '🍎'], ['Casa e Cozinha', '#e6f0ff', '🏠'], ['Electrónicos', '#ede7ff', '📱'], ['Beleza e Cuidado Pessoal', '#ffe4ef', '💄'],
  ['Moda e Calçado', '#fff3d6', '👟'], ['Bebés', '#e3f7ff', '🍼'], ['Saúde', '#e4f8ec', '💊'], ['Desporto', '#e8f5e9', '⚽'],
  ['Papelaria', '#fff8e1', '✏️'], ['Ferramentas', '#eceff1', '🔧'], ['Animais', '#fbe9e7', '🐾'], ['Acessórios para Veículos', '#e8eaf6', '🚗'],
];
/** Ofertas do dia: a seleção muda à meia-noite (a contagem é verdadeira). */
function useDayLeft(): [string, string, string] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const end = new Date(now); end.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((end.getTime() - now) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return [p(Math.floor(s / 3600)), p(Math.floor((s % 3600) / 60)), p(s % 60)];
}
const daySeed = () => { const d = new Date(); return d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate(); };
function dayShuffle<T>(arr: T[]): T[] {
  let x = daySeed(); const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { x = (x * 9301 + 49297) % 233280; const j = Math.floor((x / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Anúncios de origem do LPS Kwanza (até as empresas publicarem os seus). */
const DEFAULT_MAIN = ['h1', 'h2', 'h3', 'h4'];
const DEFAULT_SIDE = ['s1', 's2'];
function Home({ products, cats, ads, adGo, go, card, buyer }: {
  products: MP[] | null; cats: Array<[string, { n: number; img: MP }]>; ads: KBanner[]; adGo(b: KBanner): void; go(r: Route): void;
  card(p: CatalogProduct, hot?: boolean): React.ReactNode; buyer: boolean;
}) {
  const list = products ?? [];
  const promos = useMemo(() => list.filter((p) => off(p.listing) > 0).slice(0, 18), [list]);
  // Associado: produtos com mais comissão. Cliente: publicações mais recentes dos associados.
  const best = useMemo(() => (buyer ? list.slice(0, 18) : [...list].sort((a, b) => com(b.listing) - com(a.listing)).slice(0, 18)), [list, buyer]);
  const top = useMemo(() => [...list].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0)).slice(0, 18), [list]);
  const companies = useMemo(() => { const m = new Map<string, { name: string; n: number; img: MP }>(); for (const p of list) { const c = m.get(p.listing.companyCode); if (c) c.n++; else m.set(p.listing.companyCode, { name: p.listing.companyName, n: 1, img: p }); } return [...m.entries()]; }, [list]);
  const [shown, sentinel] = useInfinite(list.length, 24, list.length);
  useReveal(`${list.length}-${shown}`);
  const withImg = ads.filter((b) => b.image);
  // Anúncios das empresas primeiro; os de origem do LPS Kwanza completam o carrossel e os laterais.
  const defGo: Record<string, () => void> = {
    h1: () => go({ n: 'search', s: { q: '' } }), h2: () => go({ n: 'search', s: { q: '' } }), h3: () => go(buyer ? { n: 'register' } : { n: 'market' }), h4: () => go({ n: 'claims' }),
    s1: () => go({ n: 'search', s: { q: '' } }), s2: () => go({ n: 'search', s: { q: '' } }),
  };
  const def = (id: string): Ad => ({ id: `def-${id}`, image: `/kwanza-ads/${id}.svg`, title: 'LPS Kwanza', onClick: defGo[id] });
  const companyAds: Ad[] = withImg.map((b) => ({ id: b.id, image: bannerSrc(b), title: b.title, onClick: () => adGo(b) }));
  const heroAds: Ad[] = [...companyAds.slice(0, 6), ...DEFAULT_MAIN.map(def)].slice(0, Math.max(4, Math.min(8, companyAds.length + 2)));
  const sideAds: Ad[] = [...companyAds.slice(6, 8), ...DEFAULT_SIDE.map(def)].slice(0, 2);
  const mid = withImg.slice(8, 10);
  const dayItems = useMemo(() => dayShuffle(list).slice(0, 18), [list]);
  const [hh, mm, ss] = useDayLeft();
  const circles: Array<[string, React.ReactNode]> = (cats.length >= 6 ? cats.slice(0, 12).map(([name, c]) => [name, <Pic p={c.img} />] as [string, React.ReactNode])
    : [...cats.map(([name, c]) => [name, <Pic p={c.img} />] as [string, React.ReactNode]), ...BASE_CATS.filter(([n]) => !cats.some(([c]) => c === n)).map(([n, bg, e]) => [n, <i className="kk-emoji" style={{ background: bg }}>{e}</i>] as [string, React.ReactNode])].slice(0, 12));
  if (products === null) return <KLoader overlay={false} />;
  if (!list.length) return <div className="kk-page"><div className="kk-wrap kk-empty">Ainda sem produtos no marketplace</div></div>;
  const shelf = promos.length >= 4 ? promos : dayItems;
  return (
    <>
      {/* Telemóvel: o anúncio sobe por baixo do cabeçalho. Computador: carrossel + 2 laterais numa faixa branca. */}
      <section className="kk-hero kk-hero-m"><AdCarousel ads={heroAds} /></section>
      <section className="kk-band">
        <div className="kk-wrap">
          <div className="kk-herogrid"><AdCarousel ads={heroAds} className="kk-hg-main" /><div className="kk-hg-side">{sideAds.map((a) => <button key={a.id} className="kk-hg-ad" onClick={a.onClick} aria-label={a.title}><img src={a.image!} alt="" /></button>)}</div></div>
          <div className="kk-circles">
            {circles.map(([name, pic]) => <button key={name} className="kk-circle" onClick={() => go({ n: 'search', s: { q: '', cat: cats.some(([c]) => c === name) ? name : undefined, ...(cats.some(([c]) => c === name) ? {} : { q: name }) } })}><span>{pic}</span><small>{name}</small></button>)}
          </div>
        </div>
      </section>
      <div className="kk-wrap kk-stack">
        <section className="kk-flash kw-reveal">
          <header className="kk-flash-h"><h2><I d={P.bolt} size={20} /> {promos.length >= 4 ? 'OFERTA RELÂMPAGO' : 'OFERTAS DO DIA'}</h2>
            <span className="kk-flash-r">{promos.length >= 4 ? null : <span className="kk-count"><small>Termina em</small><b>{hh}</b>:<b>{mm}</b>:<b>{ss}</b></span>}
              <button onClick={() => go(promos.length >= 4 ? { n: 'search', s: { q: '', promo: true } } : { n: 'search', s: { q: '' } })}>Ver tudo <I d={P.next} size={14} /></button></span></header>
          <KShelf items={shelf} render={(p) => card(p)} />
        </section>
        {mid.length ? <div className={`kk-mid${mid.length > 1 ? ' two' : ''}`}>{mid.map((b) => <button key={b.id} className="kk-mid-ad" onClick={() => adGo(b)} aria-label={b.title}><img src={bannerSrc(b)!} alt="" loading="lazy" /></button>)}</div> : null}
        {cats.length > 1 ? (
          <section className="kk-box kw-reveal"><header className="kk-box-h"><h2>CATEGORIAS</h2></header>
            <div className="kk-catgrid">{cats.map(([name, c]) => <button key={name} className="kk-cat" onClick={() => go({ n: 'search', s: { q: '', cat: name } })}><span><Pic p={c.img} /></span><small>{name}</small></button>)}</div>
          </section>
        ) : null}
        {companies.length > 1 ? (
          <section className="kk-box kw-reveal"><header className="kk-box-h"><h2>LOJAS</h2></header>
            <div className="kk-catgrid">{companies.map(([code, c]) => <button key={code} className="kk-cat" onClick={() => go({ n: 'search', s: { q: c.name } })}><span><Pic p={c.img} /></span><small>{c.name}</small></button>)}</div>
          </section>
        ) : null}
        <section className="kk-box kw-reveal"><header className="kk-box-h"><h2 className="red">DESTAQUE</h2><button className="kk-more" onClick={() => go({ n: 'search', s: { q: '' } })}>Ver Tudo <I d={P.next} size={14} /></button></header>
          <KShelf items={top} render={(p) => card(p, true)} />
        </section>
        <section className="kk-disc"><header className="kk-disc-h"><h2>DESCOBERTAS DO DIA</h2></header>
          <div className="kk-grid">{list.slice(0, shown).map((p) => <div key={p.code} className="kw-reveal">{card(p)}</div>)}</div>
          {shown < list.length ? <div ref={sentinel} className="kk-more-load"><KLoader overlay={false} /></div> : null}
        </section>
      </div>
    </>
  );
}

/* ───────────── produto do marketplace ───────────── */
/** Produto aberto pela lista ou pela ligação de um associado (o cliente sem conta vê-o sempre). */
function ProductRoute({ route, list, sess, go, flash, card, products }: { route: { c: string; p: string; a?: string }; list: Listing[] | null; sess: ReturnType<typeof session.get>; go(r: Route): void; flash(t: string): void; card(p: CatalogProduct): React.ReactNode; products: MP[] }) {
  const inList = list?.find((l) => l.companyCode === route.c && l.productCode === route.p && (route.a ? l.associate?.code === route.a.toUpperCase() : true)) ?? null;
  const [fetched, setFetched] = useState<Listing | null | undefined>(undefined);
  useEffect(() => {
    // O código do associado da ligação fica guardado (30 dias, o último clique ganha).
    if (route.a && /^[A-Za-z0-9]{6}$/.test(route.a)) { try { localStorage.setItem(`kw.ref.${route.c}.${route.p}`, JSON.stringify({ a: route.a.toUpperCase(), at: Date.now() })); } catch { /* sem armazenamento */ } }
    if (list === null || inList) return;
    kw.listing(route.c, route.p, route.a).then(setFetched).catch(() => setFetched(null));
  }, [list === null, !!inList]); // eslint-disable-line react-hooks/exhaustive-deps
  const l = inList ?? fetched ?? null;
  return <Product listing={l} loading={list === null || (!inList && fetched === undefined)} refCode={route.a?.toUpperCase()} sess={sess} go={go} flash={flash} card={card} products={products} />;
}
const savedRef = (c: string, p: string): string | null => {
  try { const v = JSON.parse(localStorage.getItem(`kw.ref.${c}.${p}`) || 'null') as { a: string; at: number } | null; return v && Date.now() - v.at < 30 * 86400000 ? v.a : null; } catch { return null; }
};
const PAY_ICONS: Array<[string, string]> = [[P.card, 'Numerário na entrega'], [P.box, 'Transferência'], [P.phone, 'Multicaixa Express'], [P.doc, 'Referência']];

function Product({ listing: l, loading, refCode, sess, go, flash, card, products }: { listing: Listing | null; loading: boolean; refCode?: string; sess: ReturnType<typeof session.get>; go(r: Route): void; flash(t: string): void; card(p: CatalogProduct): React.ReactNode; products: MP[] }) {
  const [img, setImg] = useState(0);
  const swipe = useRef<number | null>(null);
  const [aff, setAff] = useState<Affiliation | null | undefined>(undefined);
  const [mk, setMk] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const viewed = useRef(false);
  useEffect(() => { if (l && !viewed.current) { viewed.current = true; void kw.view(l.companyCode, l.productCode).catch(() => undefined); } }, [l]);
  useEffect(() => {
    if (!sess || !l) { setAff(null); return; }
    kw.affiliations(sess.token).then((r) => { const f = r.find((x) => x.companyCode === l.companyCode && x.productCode === l.productCode) ?? null; setAff(f); setMk(f?.markupPct ? String(f.markupPct) : ''); }).catch(() => setAff(null));
  }, [sess?.token, l?.companyCode, l?.productCode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <KLoader overlay={false} />;
  if (!l) return <div className="kk-page"><div className="kk-wrap kk-empty">Produto indisponível</div></div>;
  const pics = [l.imageUrl, ...l.gallery].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  // Publicação de um associado: o cliente compra pela ligação dele (comissão e preço próprio atribuídos).
  const post = l.associate ? l : null;
  // A compra faz-se aqui no LPS Kwanza, com o associado que trouxe o cliente.
  const assocCode = post?.associate?.code ?? refCode ?? savedRef(l.companyCode, l.productCode);
  const mine = !!sess && assocCode === sess.associate.code;
  // Publicação de OUTRO associado: o associado com sessão vê e compra, mas não a edita (cada um edita só a sua).
  const othersPost = !!post && !!sess && post.associate!.code !== sess.associate.code;
  const addToCart = (andGo: boolean) => { cart.add(l, 1, mine ? null : assocCode ?? null); if (andGo) go({ n: 'cart' }); else flash('Adicionado ao carrinho'); };
  const yt = l.videoUrl ? /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i.exec(l.videoUrl)?.[1] : undefined;
  const pct = aff?.status === 'APPROVED' ? aff.commissionPct : l.commissionPct;
  const link = sess ? shareLink(l.companyCode, l.productCode, sess.associate.code) : '';
  const self = toMP(l).code;
  const similar = products.filter((p) => p.code !== self && p.category && p.category === l.category).slice(0, 12);
  const fromStore = products.filter((p) => p.code !== self && p.listing.companyCode === l.companyCode && !similar.includes(p)).slice(0, 12);
  const join = async () => {
    if (!sess) { go({ n: 'register' }); return; }
    setBusy(true);
    try { const r = await kw.affiliate(sess.token, l.companyCode, l.productCode); flash(r.status === 'APPROVED' ? 'Associado a este produto' : 'Pedido de afiliação enviado'); const all = await kw.affiliations(sess.token); setAff(all.find((x) => x.companyCode === l.companyCode && x.productCode === l.productCode) ?? null); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Não foi possível'); } finally { setBusy(false); }
  };
  const saveMk = async () => { if (!sess) return; try { const r = await kw.markup(sess.token, l.companyCode, l.productCode, mk ? Number(mk) : null); setMk(r.markupPct ? String(r.markupPct) : ''); flash('Preço próprio guardado'); } catch (e) { flash(e instanceof ApiError ? e.message : 'Não foi possível'); } };
  const copy = async () => { try { await navigator.clipboard.writeText(link); flash('Ligação copiada'); } catch { window.prompt('Copie:', link); } };
  const d = off(l);
  return (
    <div className="kk-page kk-pdp">
      <div className="kk-wrap">
        <div className="kk-pdp-top">
          <div className="kk-gal">
            {pics.length > 1 ? <div className="kk-thumbs">{pics.map((u, i) => <button key={u} className={i === img ? 'on' : ''} onMouseEnter={() => setImg(i)} onClick={() => setImg(i)} aria-label={`Imagem ${i + 1}`}><img src={u} alt="" loading="lazy" /></button>)}</div> : null}
            <div className="kk-gal-main" onTouchStart={(e) => { swipe.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => { const x0 = swipe.current; swipe.current = null; if (x0 == null || pics.length < 2) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) setImg((i) => (i + (dx < 0 ? 1 : -1) + pics.length) % pics.length); }}>
              {pics.length ? <img src={pics[img] ?? pics[0]} alt={l.name} /> : <Pic p={toMP(l)} />}
              {pics.length > 1 ? <>
                <button type="button" className="kk-gal-nav prev" aria-label="Imagem anterior" onClick={() => setImg((i) => (i - 1 + pics.length) % pics.length)}><I d={P.back} size={18} /></button>
                <button type="button" className="kk-gal-nav next" aria-label="Imagem seguinte" onClick={() => setImg((i) => (i + 1) % pics.length)}><I d={P.next} size={18} /></button>
                <span className="kk-gal-dots">{pics.map((u, i) => <i key={u} className={i === img ? 'on' : ''} />)}</span>
                <span className="kk-gal-n">{img + 1}/{pics.length}</span>
              </> : null}
            </div>
          </div>
          <div className="kk-info">
            <h1>{l.name}</h1>
            <div className="kk-info-meta">
              <span className="kk-chip"><I d={P.bag} size={14} /> {l.companyName}</span>
              {l.views ? <span className="kk-chip"><I d={P.eye} size={14} /> {l.views}</span> : null}
              {l.sold ? <span className="kk-chip">{l.sold} vendidos</span> : null}
              {l.inStock ? <span className="kk-chip kk-stock"><I d={P.box} size={14} /> {l.stockQty && l.stockQty > 0 ? `${l.stockQty} em stock` : 'Disponível'}</span> : <span className="kk-chip kk-stock out">Esgotado</span>}
            </div>
            <div className="kk-offer">
              {d > 0 ? <div className="kk-offer-h">-{d}%</div> : null}
              <div className="kk-offer-b">{d > 0 && l.listPrice ? <s>{kz(l.listPrice)}</s> : null}<b>{kz(l.grossPrice)}</b></div>
            </div>
            {!post ? <button className="kk-aff-link" onClick={() => void join()} disabled={busy}><I d={P.share} size={16} /> {aff?.status === 'APPROVED' ? `Associado · comissão de até ${kz(com(l, pct))}` : `Vender como associado · comissão de até ${kz(com(l, pct))}`}</button> : null}
            <div className="kk-sold-by"><I d={P.pin} size={18} /> Vendido por: <b>{l.companyName}</b></div>
            <div className="kk-paybox"><h3>Formas de pagamento</h3><div className="kk-payicons">{PAY_ICONS.map(([ic, t]) => <span key={t}><I d={ic} size={20} /><small>{t}</small></span>)}</div></div>
            {post ? <div className="kk-post-by"><span className="kk-avatar big">{post.associate!.photoUrl ? <img src={post.associate!.photoUrl} alt="" /> : <b>{post.associate!.name.slice(0, 1).toUpperCase()}</b>}</span><div><small>Publicado por</small><b>{post.associate!.name}</b></div></div> : null}
            {post?.caption ? <p className="kk-cap">{post.caption}</p> : null}
            <div className="kk-buy-desk">
              {l.inStock ? <div className="kk-buybtns"><button className="kk-btn-add" onClick={() => addToCart(false)}><I d={P.cart} size={18} /> Adicionar ao carrinho</button><button className="kk-btn-buy" onClick={() => addToCart(true)}>Comprar</button></div> : <span className="kw-pill kw-st-CANCELLED">Esgotado</span>}
            </div>
            {sess ? <button className="kk-ghost" onClick={() => go({ n: 'msgs', c: l.companyCode })}><I d={P.chat} size={16} /> Falar com a empresa</button> : null}
            {/* Ferramentas do associado (afiliação, ligação, preço próprio, publicação). */}
            {othersPost ? <button className="kk-ghost" onClick={() => go({ n: 'product', c: l.companyCode, p: l.productCode, a: sess!.associate.code })}><I d={P.share} size={16} /> Ver a minha publicação deste produto</button>
              : !sess && post ? null : aff?.status === 'APPROVED' ? (
              <div className="kk-aff">
                <div className="kk-aff-row"><span>Comissão</span><b>{pct}% · {kz(com(l, pct))}{aff.negotiated ? ' · negociada' : ''}</b></div>
                <div className="kw-aff-link"><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Ligação de associado" /></div>
                <div className="kk-aff-acts">
                  <button className="kk-btn-buy sm" onClick={() => void copy()}>Copiar ligação</button>
                  <a className="kk-btn-wa" href={`https://wa.me/?text=${encodeURIComponent(`${l.name} — ${kz(l.grossPrice)}\n${link}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  <button className="kk-ghost" onClick={() => setEditing(true)}><I d={P.share} size={16} /> {aff.published ? 'Editar publicação' : 'Publicar no marketplace'}</button>
                </div>
                {l.allowMarkup ? <div className="kk-aff-mk"><label className="kw-f"><span>Preço próprio (+%{l.maxMarkupPct != null ? ` até ${l.maxMarkupPct}%` : ''})</span><input inputMode="decimal" value={mk} onChange={(e) => setMk(e.target.value.replace(/[^\d.]/g, ''))} /></label><button className="kk-ghost" onClick={() => void saveMk()}>Guardar</button></div> : null}
                {l.materials.length ? <div className="kw-mats"><b>Materiais de divulgação</b>{l.materials.map((m, i) => <a key={m} href={m} target="_blank" rel="noopener noreferrer"><I d={P.doc} size={14} /> Material {i + 1}</a>)}</div> : null}
              </div>
            ) : aff?.status === 'PENDING' ? <span className="kw-pill kw-st-PENDING">Pedido de afiliação em análise</span>
              : aff?.status === 'REJECTED' ? <span className="kw-pill kw-st-CANCELLED">Afiliação recusada</span>
              : l.affiliation === 'RESTRICTED' ? <span className="kk-card-restr"><I d={P.close} size={13} /> Afiliação Restrita</span> : null}
          </div>
        </div>
        <section className="kk-box"><header className="kk-box-h"><h2>Detalhes</h2></header>
          <div className={`kk-desc${more ? ' open' : ''}`}>
            <h3>O que precisa de saber sobre este produto</h3>
            {l.category ? <p className="kk-desc-k"><span>Categoria:</span> {l.category}</p> : null}
            {l.description ? <p>{l.description}</p> : null}
            {l.videoUrl ? (yt ? <div className="kw-video"><iframe src={`https://www.youtube-nocookie.com/embed/${yt}`} title="Vídeo do produto" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen /></div>
              : <a className="kk-ghost" href={l.videoUrl} target="_blank" rel="noopener noreferrer"><I d={P.eye} size={16} /> Ver vídeo</a>) : null}
            {pics.slice(1, 4).map((u) => <img key={u} src={u} alt="" loading="lazy" className="kk-desc-img" />)}
          </div>
          {(l.description?.length ?? 0) > 280 || pics.length > 1 ? <div className="kk-desc-more"><button onClick={() => setMore((m) => !m)}>{more ? 'Ver menos' : 'Ver mais'}</button></div> : null}
        </section>
        <section className="kk-box"><header className="kk-box-h"><h2>Loja</h2></header>
          <div className="kk-store"><span className="kk-store-ic"><I d={P.bag} size={22} /></span><div><b>{l.companyName}</b><small>{products.filter((p) => p.listing.companyCode === l.companyCode).length} produtos no LPS Kwanza</small></div>
            <button className="kk-more" onClick={() => go({ n: 'search', s: { q: l.companyName } })}>Ver todos desta loja <I d={P.next} size={14} /></button></div>
        </section>
        <ProductSocial l={l} flash={flash} />
        {similar.length ? <section className="kk-box"><header className="kk-box-h"><h2>Produtos similares</h2>{l.category ? <button className="kk-more" onClick={() => go({ n: 'search', s: { q: '', cat: l.category! } })}>Ver todos em {l.category} <I d={P.next} size={14} /></button> : null}</header><div className="kk-grid">{similar.map((p) => <div key={p.code}>{card(p)}</div>)}</div></section> : null}
        {fromStore.length ? <section className="kk-box"><header className="kk-box-h"><h2>Mais de {l.companyName}</h2><button className="kk-more" onClick={() => go({ n: 'search', s: { q: l.companyName } })}>Ver todos desta loja <I d={P.next} size={14} /></button></header><div className="kk-grid">{fromStore.map((p) => <div key={p.code}>{card(p)}</div>)}</div></section> : null}
      </div>
      {l.inStock ? (
        <div className="kk-buybar"><div className="kk-wrap kk-buybar-in">
          <b className="kk-buybar-price">{kz(l.grossPrice)}</b>
          <div className="kk-buybtns"><button className="kk-btn-add" onClick={() => addToCart(false)}><I d={P.cart} size={18} /> Adicionar ao carrinho</button><button className="kk-btn-buy" onClick={() => addToCart(true)}>Comprar</button></div>
        </div></div>
      ) : null}
      {editing && aff && sess && !othersPost ? <PostEditor token={sess.token} a={aff} onClose={() => setEditing(false)} onSaved={(m) => { setEditing(false); flash(m); void kw.affiliations(sess.token).then((r) => setAff(r.find((x) => x.companyCode === l.companyCode && x.productCode === l.productCode) ?? null)); }} /> : null}
    </div>
  );
}

/* ───────────── entrar / criar conta / recuperar ───────────── */
function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="kw-auth-card kw-pop"><div className="kw-auth-brand"><img src="/logo-mark.png" alt="LPS Vendas" width={120} height={120} /><strong>{BRAND}</strong></div><h2 className="kw-auth-t">{title}</h2>{children}</div>;
}
function Login({ onDone, go }: { onDone(): void; go(r: Route): void }) {
  const [login, setLogin] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<CodeAsk | null>(null); const [code, setCode] = useState('');
  const send = async (resend = false) => {
    setErr(null); setBusy(true);
    try { session.set(await kw.login({ login, password: pw, twoFaCode: !resend && ask ? code : undefined, twoFaResend: resend || undefined })); onDone(); }
    catch (er) { const a = codeAsk(er); if (a) { setAsk(a); setCode(''); } else setErr(er instanceof ApiError ? er.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => { e.preventDefault(); await send(); };
  return (
    <AuthCard title="Entra com o teu telefone ou email">
      <form className="kw-auth-form" onSubmit={(e) => void submit(e)}>
        <label className="kw-f"><span>Telefone ou email</span><input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" /></label>
        <label className="kw-f"><span>Senha</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
        {ask ? <CodeBox ask={ask} code={code} setCode={setCode} busy={busy} onResend={() => void send(true)} onEnter={() => void send()} /> : null}
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-primary kw-block" disabled={busy || (!!ask && code.length !== 6)}>{busy ? 'Um momento…' : ask ? 'Confirmar código' : 'Entrar'}</button>
        <div className="kw-auth-links"><span>Esqueceu a senha? <button type="button" className="kw-link" onClick={() => go({ n: 'recover' })}>Recuperar</button></span><span>Não tem conta? <button type="button" className="kw-link" onClick={() => go({ n: 'register' })}>Criar conta</button></span></div>
      </form>
    </AuthCard>
  );
}
function Register({ onDone, go }: { onDone(): void; go(r: Route): void }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr(null); setBusy(true); try { session.set(await kw.register({ ...f, email: f.email || undefined })); onDone(); } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível criar a conta.'); } finally { setBusy(false); } };
  return (
    <AuthCard title="Cria a tua conta de associado">
      <form className="kw-auth-form" onSubmit={(e) => void submit(e)}>
        <label className="kw-f"><span>Nome completo</span><input value={f.name} onChange={set('name')} autoComplete="name" /></label>
        <label className="kw-f"><span>Telefone</span><input value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="9XX XXX XXX" /></label>
        <label className="kw-f"><span>Email (para recuperar a senha)</span><input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <label className="kw-f"><span>Senha</span><input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></label>
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-primary kw-block" disabled={busy}>{busy ? 'Um momento…' : 'Criar conta'}</button>
        <div className="kw-auth-links"><span>Já tem conta? <button type="button" className="kw-link" onClick={() => go({ n: 'login' })}>Entrar</button></span></div>
      </form>
    </AuthCard>
  );
}
function Recover({ go, flash }: { go(r: Route): void; flash(t: string): void }) {
  const [login, setLogin] = useState(''); const [code, setCode] = useState(''); const [pw, setPw] = useState(''); const [step, setStep] = useState<1 | 2>(1); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [via, setVia] = useState<{ via: string | null; to: string | null } | null>(null);
  const [ask, setAsk] = useState<CodeAsk | null>(null); const [tf, setTf] = useState('');
  const confirm = async (resend = false) => {
    setErr(null); setBusy(true);
    try { await kw.recoverConfirm({ login, code, password: pw, twoFaCode: !resend && ask ? tf : undefined, twoFaResend: resend || undefined }); flash('Senha alterada'); go({ n: 'login' }); }
    catch (er) { const a = codeAsk(er); if (a) { setAsk(a); setTf(''); } else setErr(er instanceof ApiError ? er.message : 'Não foi possível.'); }
    finally { setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 2) { await confirm(); return; }
    setErr(null); setBusy(true);
    try { const r = await kw.recover(login); setVia({ via: r.via, to: r.to }); setStep(2); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível.'); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Recuperar a senha">
      <form className="kw-auth-form" onSubmit={(e) => void submit(e)}>
        <label className="kw-f"><span>Telefone ou email da conta</span><input value={login} onChange={(e) => setLogin(e.target.value)} disabled={step === 2} /></label>
        {step === 2 ? (
          <>
            <label className="kw-f"><span>{via?.via === 'WHATSAPP' ? 'Código recebido por WhatsApp' : 'Código recebido por email'}{via?.to ? ` (${via.to})` : ''}</span><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></label>
            <label className="kw-f"><span>Nova senha</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
            {ask ? <CodeBox ask={ask} code={tf} setCode={setTf} busy={busy} onResend={() => void confirm(true)} onEnter={() => void confirm()} /> : null}
          </>
        ) : null}
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-primary kw-block" disabled={busy}>{busy ? 'Um momento…' : step === 1 ? 'Enviar código' : 'Guardar nova senha'}</button>
        <div className="kw-auth-links"><button type="button" className="kw-link" onClick={() => go({ n: 'login' })}>Voltar a entrar</button></div>
      </form>
    </AuthCard>
  );
}


const Loader = () => <KLoader overlay={false} />;

/* ───────────── área do associado (menu lateral como no Kikolo) ───────────── */
type AreaTab = 'panel' | 'sales' | 'market' | 'affs' | 'withdraw' | 'accounts' | 'profile' | 'msgs';
const STATE: Record<string, [string, string]> = { PENDING: ['Pendente', 'kw-st-PENDING'], AVAILABLE: ['Disponível', 'kw-st-PAID'], CANCELLED: ['Cancelada', 'kw-st-CANCELLED'], APPROVED: ['Aprovada', 'kw-st-PAID'], REJECTED: ['Recusada', 'kw-st-CANCELLED'], REQUESTED: ['Em análise', 'kw-st-PENDING'], PAID: ['Pago', 'kw-st-PAID'], REFUNDED: ['Reembolsado', 'kw-st-PAID'] };
const TITLES: Record<AreaTab, [string, string]> = {
  panel: ['Dashboard', P.grid], sales: ['Minhas vendas', P.bag], market: ['Mercado de Associados', P.share], affs: ['Minhas afiliações', P.share],
  withdraw: ['Histórico de transações', P.card], accounts: ['Contas bancárias', P.shield], profile: ['Meu Perfil', P.user], msgs: ['Mensagens', P.chat],
};

function AreaMenu({ route, go, onPick }: { route: AreaTab; go(r: Route): void; onPick?(): void }) {
  const [openG, setOpenG] = useState<Record<string, boolean>>({ v: true, p: true, m: true, c: true });
  const item = (k: AreaTab, label: string, ic: string, tag?: string) => (
    <button key={k} className={`kk-nav-i${route === k ? ' on' : ''}`} onClick={() => { onPick?.(); go({ n: k } as Route); }}><I d={ic} size={18} /><span>{label}</span>{tag ? <em>{tag}</em> : null}</button>
  );
  const group = (id: string, title: string, items: React.ReactNode) => (
    <div className="kk-nav-g" key={id}>
      <button className="kk-nav-gh" aria-expanded={openG[id]} onClick={() => setOpenG((g) => ({ ...g, [id]: !g[id] }))}><span>{title}</span><I d={openG[id] ? P.up : P.down} size={16} /></button>
      {openG[id] ? <div className="kk-nav-gb">{items}</div> : null}
    </div>
  );
  return (
    <nav className="kk-nav" aria-label="Área do associado">
      {group('v', 'VENDAS 🔥', <>{item('panel', 'Painel do associado', P.grid)}{item('sales', 'Minhas Vendas', P.card)}{item('market', 'Para Associados', P.share, 'Venda +')}{item('withdraw', 'Transações (Saques)', P.box)}</>)}
      {group('p', 'PRODUTOS', <>{item('affs', 'Minhas afiliações', P.bag)}</>)}
      {group('m', 'MENSAGENS', <>{item('msgs', 'Mensagens', P.chat)}</>)}
      {group('c', 'DEFINIÇÕES DA CONTA', <>{item('profile', 'Perfil', P.user)}{item('accounts', 'Contas bancárias', P.shield)}</>)}
      <button className="kk-nav-i out" onClick={() => { onPick?.(); session.clear(); go({ n: 'home' }); }}><I d={P.close} size={18} /><span>Terminar sessão</span></button>
    </nav>
  );
}

function Area({ route, chat, go, token, me, flash, products, ads }: { route: AreaTab; chat?: string; go(r: Route): void; token: string; me: Associate; flash(t: string): void; products: MP[]; ads: KBanner[] }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [drawer, setDrawer] = useState(false);
  const load = useCallback(() => kw.dashboard(token).then(setD).catch(() => undefined), [token]);
  // Tempo real: vendas, estado das encomendas e saldo voltam a ser lidos sozinhos.
  useEffect(() => {
    void load();
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    const t = window.setInterval(again, 8000);
    window.addEventListener('focus', again);
    return () => { window.clearInterval(t); window.removeEventListener('focus', again); };
  }, [load]);
  const banner = ads.find((b) => b.image);
  let body: React.ReactNode;
  if (route === 'panel') body = <Panel d={d} go={go} products={products} banner={banner} />;
  else if (route === 'sales') body = <SalesT d={d} />;
  else if (route === 'market') body = <Market products={products} go={go} banner={banner} />;
  else if (route === 'affs') body = <Affs token={token} go={go} flash={flash} />;
  else if (route === 'withdraw') body = <Withdraw token={token} d={d} onDone={() => { void load(); flash('Pedido de saque enviado'); }} go={go} />;
  else if (route === 'accounts') body = <Accounts token={token} flash={flash} />;
  else if (route === 'msgs') body = <MsgsRoute token={token} chat={chat} go={go} />;
  else body = <Profile token={token} me={me} flash={flash} />;
  const [title, icon] = TITLES[route];
  return (
    <div className="kk-page"><div className="kk-wrap kk-area">
      <aside className="kk-side"><AreaMenu route={route} go={go} /></aside>
      <section className="kk-area-main">
        <button className="kk-menu-btn" onClick={() => setDrawer(true)}><I d={P.filter} size={18} /> Menu</button>
        <h1 className="kk-ptitle"><span><I d={icon} size={20} /></span>{title}</h1>
        {body}
      </section>
      {drawer ? <><div className="kk-scrim" onClick={() => setDrawer(false)} /><div className="kk-drawer left" role="dialog" aria-label="Menu"><div className="kk-drawer-h"><b>Menu</b><button className="kk-x" onClick={() => setDrawer(false)} aria-label="Fechar"><I d={P.close} size={20} /></button></div><AreaMenu route={route} go={go} onPick={() => setDrawer(false)} /></div></> : null}
    </div></div>
  );
}

/** Conversas: empresas das afiliações aparecem para iniciar uma conversa nova. */
function MsgsRoute({ token, chat, go }: { token: string; chat?: string; go(r: Route): void }) {
  const [affs, setAffs] = useState<Affiliation[]>([]);
  useEffect(() => { kw.affiliations(token).then(setAffs).catch(() => undefined); }, [token]);
  const companies = useMemo(() => [...new Map(affs.map((a) => [a.companyCode, { code: a.companyCode, name: a.companyName }])).values()], [affs]);
  return <Messages token={token} company={chat} companies={companies} go={(c) => go({ n: 'msgs', c })} />;
}

/** Cartão branco da área do associado. */
function Sec({ title, action, children, className = '' }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`kk-card2 ${className}`}>
      {title || action ? <header className="kk-card2-h">{title ? <h3>{title}</h3> : null}{action}</header> : null}
      {children}
    </section>
  );
}
function Kpi({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: '' | 'main' | 'ok' | 'off' | 'warn' }) {
  return <div className={`kk-kpi ${tone}`}><b>{value}</b><span>{label}</span>{sub ? <small>{sub}</small> : null}</div>;
}

/** Calendário do mês (como no painel do Kikolo): hoje marcado, dias futuros esbatidos. */
/** Calendário do painel: escolhe um dia ou um intervalo (2 cliques) para filtrar o desempenho. */
type Range = { from: Date; to: Date } | null;
const dayKey = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
function MonthCal({ marks, sel, onSel }: { marks: Set<string>; sel: Range; onSel(r: Range): void }) {
  const [ref, setRef] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [anchor, setAnchor] = useState<Date | null>(null);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(ref); const wd = (start.getDay() + 6) % 7; start.setDate(1 - wd);
  const days = Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
  const label = ref.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const pick = (x: Date) => {
    if (x > today) return;
    if (anchor && !(sel && sel.from.getTime() !== sel.to.getTime())) {
      const [a, b] = anchor <= x ? [anchor, x] : [x, anchor];
      onSel({ from: a, to: b }); setAnchor(null);
    } else { onSel({ from: x, to: x }); setAnchor(x); }
  };
  const inSel = (x: Date) => !!sel && x >= sel.from && x <= sel.to;
  return (
    <div className="kk-cal">
      <div className="kk-cal-h"><button type="button" onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))} aria-label="Mês anterior"><I d={P.back} size={16} /></button><b>{label}</b>
        <button type="button" onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))} disabled={ref.getFullYear() === today.getFullYear() && ref.getMonth() === today.getMonth()} aria-label="Mês seguinte"><I d={P.next} size={16} /></button></div>
      <div className="kk-cal-g" role="grid">{['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((w) => <small key={w}>{w}</small>)}
        {days.map((x) => {
          const fut = x > today;
          const cls = `${x.getMonth() !== ref.getMonth() ? 'out ' : ''}${x.getTime() === today.getTime() ? 'today ' : ''}${fut ? 'future ' : ''}${inSel(x) ? 'sel ' : ''}${sel && (x.getTime() === sel.from.getTime() || x.getTime() === sel.to.getTime()) ? 'edge ' : ''}${marks.has(dayKey(x)) ? 'has' : ''}`;
          return <button type="button" key={x.toISOString()} className={cls} disabled={fut} aria-pressed={inSel(x)} aria-label={x.toLocaleDateString('pt-PT')} onClick={() => pick(x)}>{x.getDate()}</button>;
        })}</div>
      {sel ? <button type="button" className="kk-cal-clear" onClick={() => { onSel(null); setAnchor(null); }}>Limpar filtro</button> : null}
    </div>
  );
}

function Panel({ d, go, products, banner }: { d: Dashboard | null; go(r: Route): void; products: MP[]; banner?: KBanner }) {
  const [byViews, setByViews] = useState(true);
  const [sel, setSel] = useState<Range>(null);
  const marks = useMemo(() => new Set((d?.sales ?? []).filter((s) => s.state !== 'CANCELLED').map((s) => dayKey(new Date(s.date)))), [d]);
  const inRange = (iso: string) => { if (!sel) return true; const x = new Date(iso); const end = new Date(sel.to); end.setDate(end.getDate() + 1); return x >= sel.from && x < end; };
  const ranged = (d?.sales ?? []).filter((s) => inRange(s.date));
  const valid = (d?.sales ?? []).filter((s) => s.state !== 'CANCELLED');
  const rValid = ranged.filter((s) => s.state !== 'CANCELLED');
  const rLabel = sel ? (sel.from.getTime() === sel.to.getTime() ? sel.from.toLocaleDateString('pt-PT') : `${sel.from.toLocaleDateString('pt-PT')} – ${sel.to.toLocaleDateString('pt-PT')}`) : '';
  const since = (days: number) => valid.filter((s) => new Date(s.date).getTime() >= Date.now() - days * 86400000).reduce((a, s) => a + s.amount, 0);
  const today = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return valid.filter((s) => new Date(s.date) >= t).reduce((a, s) => a + s.amount, 0); })();
  const yesterday = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); const y = new Date(t); y.setDate(t.getDate() - 1); return valid.filter((s) => { const x = new Date(s.date); return x >= y && x < t; }).reduce((a, s) => a + s.amount, 0); })();
  const trend = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : today > 0 ? 100 : 0;
  const total = (d?.withdrawn ?? 0) + (d?.balance ?? 0) + (d?.pending ?? 0);
  const ring = total > 0 ? (d?.withdrawn ?? 0) / total : 0;
  const top = [...products].sort((a, b) => (byViews ? (b.views ?? 0) - (a.views ?? 0) : com(b.listing) - com(a.listing))).slice(0, 8);
  const done = ranged.filter((s) => s.state === 'AVAILABLE');
  const cancelled = ranged.filter((s) => s.state === 'CANCELLED');
  return (
    <div className="kk-dash">
      {banner ? <img className="kk-dash-ad" src={bannerSrc(banner)!} alt="" /> : null}
      <Sec className="kk-bal">
        <div className="kk-bal-main">
          <div className="kk-stat"><span className="kk-stat-ic green"><I d={P.card} size={20} /></span><div><small>Saldo disponível</small><b>{kz(d?.balance ?? 0)}</b></div></div>
          <button className="kk-btn-primary" onClick={() => go({ n: 'withdraw' })}>Solicitar saque</button>
        </div>
        <div className="kk-bal-row">
          <div className="kk-stat"><span className="kk-stat-ic blue"><I d={P.clock} size={20} /></span><div><small>Vendas em processo</small><b>{kz(d?.pending ?? 0)}</b></div></div>
          <div className="kk-stat"><span className="kk-stat-ic soft"><I d={P.box} size={20} /></span><div><small>Saldo pendente</small><b>{kz(d?.requested ?? 0)}</b></div></div>
        </div>
        <div className="kk-bal-perf">
          <MonthCal marks={marks} sel={sel} onSel={setSel} />
          <div className="kk-perf">
            <h3>Desempenho de vendas{sel ? <span className="kk-perf-range">{rLabel}</span> : null}</h3>
            <div className="kk-perf-in">
              {sel ? (
                <div className="kk-perf-l">
                  <div><small>Comissões no período</small><b className="o">{kz(rValid.reduce((a, s) => a + s.amount, 0))}</b></div>
                  <div><small>Vendas no período</small><b className="o">{rValid.length}</b></div>
                  <div><small>Já disponível</small><b>{kz(done.reduce((a, s) => a + s.amount, 0))}</b></div>
                </div>
              ) : (
                <div className="kk-perf-l">
                  <div><small>Hoje <em className={trend < 0 ? 'down' : 'up'}>{trend}%</em></small><b className="o">{kz(today)}</b></div>
                  <div><small>Total últimos 7 dias</small><b className="o">{kz(since(7))}</b></div>
                  <div><small>Total últimos 30 dias</small><b>{kz(since(30))}</b></div>
                </div>
              )}
              <div className="kk-ring"><svg viewBox="0 0 120 120" width="150" height="150"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--kk-ring)" strokeWidth="12" />{ring > 0 ? <circle cx="60" cy="60" r="50" fill="none" stroke="var(--kk-p)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${ring * 314} 314`} transform="rotate(-90 60 60)" /> : null}</svg><div><b>{kz(d?.withdrawn ?? 0)}</b><small>Total já retirado</small></div></div>
            </div>
          </div>
        </div>
        <div className="kk-bal-sum">
          <div><span>Vendas completas :</span><b className="ok">{kz(done.reduce((a, s) => a + s.amount, 0))}</b></div>
          <div><span>Número de vendas{sel ? ` (${rLabel})` : ''} :</span><b>{rValid.length}</b></div>
          <div><span>Vendas canceladas :</span><b>{cancelled.length}</b></div>
        </div>
      </Sec>
      {d?.companies.length ? (
        <Sec title="Saldo por empresa">
          <div className="kk-rows">
            {d.companies.map((c) => (
              <div className="kk-row4" key={c.companyId}>
                <b>{c.companyName}</b>
                <span><small>Em processo</small>{kz(c.pending)}</span>
                <span><small>Disponível</small><b className="kk-p">{kz(c.balance)}</b></span>
                <span><small>Retirado</small>{kz(c.withdrawn)}</span>
              </div>
            ))}
          </div>
        </Sec>
      ) : null}
      <Sec title={<><I d={P.grid} size={18} /> Seus produtos com mais cliques</>} action={<label className="kk-toggle"><input type="checkbox" checked={!byViews} onChange={(e) => setByViews(!e.target.checked)} /><i aria-hidden="true" />{byViews ? 'Vistos agora' : 'Mais comissão'}</label>}>
        {top.length ? <div className="kk-grid tight">{top.map((p) => <div key={p.code}><KCard p={p} aff onOpen={() => { const [c, pc] = p.code.split('::'); go({ n: 'product', c, p: pc }); }} /></div>)}</div> : <div className="kk-empty">Sem produtos disponíveis</div>}
      </Sec>
    </div>
  );
}

function Market({ products, go, banner }: { products: MP[]; go(r: Route): void; banner?: KBanner }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  // Cada produto da empresa uma vez (sem as publicações repetidas dos associados).
  const base = useMemo(() => { const m = new Map<string, MP>(); for (const p of products) { const k = `${p.listing.companyCode}::${p.listing.productCode}`; if (!m.has(k) || !p.listing.associate) m.set(k, p); } return [...m.values()]; }, [products]);
  const rows = base.filter((p) => !term || `${p.name} ${p.listing.companyName} ${p.category ?? ''}`.toLowerCase().includes(term));
  const [shown, sentinel] = useInfinite(rows.length, 24, `${rows.length}-${term}`);
  return (
    <div className="kk-dash">
      {banner ? <img className="kk-dash-ad" src={bannerSrc(banner)!} alt="" /> : null}
      <div className="kk-mk-btns">
        <button className="kk-ob" onClick={() => go({ n: 'sales' })}>Minhas Vendas 🔥</button>
        <button className="kk-sb" onClick={() => go({ n: 'affs' })}>Minhas afiliações</button>
        <button className="kk-ob blue" onClick={() => go({ n: 'withdraw' })}>Transações (Saques)</button>
        <button className="kk-ob blue" onClick={() => go({ n: 'msgs' })}>Mensagens</button>
      </div>
      <label className="kk-input"><I d={P.search} size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" /></label>
      <h2 className="kk-sub"><I d={P.star} size={20} /> Produtos</h2>
      {!rows.length ? <div className="kk-empty">Sem produtos disponíveis</div> : <div className="kk-grid">{rows.slice(0, shown).map((p) => <div key={p.code}><KCard p={p} aff onOpen={() => { const [c, pc] = p.code.split('::'); go({ n: 'product', c, p: pc }); }} /></div>)}</div>}
      {shown < rows.length ? <div ref={sentinel} className="kk-more-load"><KLoader overlay={false} /></div> : null}
    </div>
  );
}

function SalesT({ d }: { d: Dashboard | null }) {
  const [f, setF] = useState<'ALL' | 'PENDING' | 'AVAILABLE' | 'CANCELLED'>('ALL');
  const [q, setQ] = useState('');
  if (!d) return <KLoader overlay={false} />;
  const term = q.trim().toLowerCase();
  const rows = d.sales.filter((s) => (f === 'ALL' || s.state === f) && (!term || `${s.companyName} ${s.orderNumber} ${s.product}`.toLowerCase().includes(term)));
  return (
    <div className="kk-dash">
      <div className="kk-filters">
        <select value={f} onChange={(e) => setF(e.target.value as typeof f)} aria-label="Estado"><option value="ALL">Todas as vendas</option><option value="PENDING">Em processo</option><option value="AVAILABLE">Disponíveis</option><option value="CANCELLED">Canceladas</option></select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Por encomenda, produto ou empresa" aria-label="Pesquisar vendas" />
      </div>
      {!rows.length ? <div className="kk-empty">{d.sales.length ? 'Nenhuma venda neste filtro' : 'Ainda sem vendas'}</div> : (
        <div className="kk-rows">
          {rows.map((s, i) => (
            <div className="kk-sale" key={`${s.orderNumber}-${i}`}>
              <div className="kk-sale-m"><b>{s.product}</b><small>{s.companyName} · {s.quantity} un. · {formatDateTime(s.date)}</small>
                <span className="kk-sale-o">{s.orderNumber}{s.orderStatus ? <span className={`kw-ost kw-ost-${s.orderStatus}`}>{s.orderStatus === 'PENDING' && s.paymentClaimed ? 'Pagamento enviado' : ORDER_LABEL[s.orderStatus] ?? s.orderStatus}</span> : null}</span></div>
              <div className="kk-sale-r"><b>{kz(s.amount)}</b><span className={`kw-pill ${STATE[s.state][1]}`}>{STATE[s.state][0]}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Withdraw({ token, d, onDone, go }: { token: string; d: Dashboard | null; onDone(): void; go(r: Route): void }) {
  const [accs, setAccs] = useState<PayoutAccount[] | null>(null);
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(''); const [amount, setAmount] = useState(''); const [acc, setAcc] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<CodeAsk | null>(null); const [tf, setTf] = useState('');
  const [claim, setClaim] = useState<string | null>(null); const [claimTx, setClaimTx] = useState(''); const [claimErr, setClaimErr] = useState<string | null>(null);
  const now = useNow();
  useEffect(() => { kw.accounts(token).then((r) => { setAccs(r); if (r[0]) setAcc(r[0].id); }).catch(() => setAccs([])); }, [token]);
  useEffect(() => { const c = d?.companies.find((x) => x.balance > 0); if (c && !company) setCompany(c.companyCode); }, [d, company]);
  if (!d) return <KLoader overlay={false} />;
  const cur = d.companies.find((c) => c.companyCode === company);
  const frozenWhy = d.frozen?.[company];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); const a = Number(amount.replace(',', '.'));
    if (frozenWhy !== undefined) { setErr(`Saldo congelado por esta empresa: ${frozenWhy}`); return; }
    if (!cur) { setErr('Escolha a empresa.'); return; } if (!(a > 0) || a > cur.balance) { setErr('Valor inválido para o saldo desta empresa.'); return; } if (!acc) { setErr('Escolha a conta.'); return; }
    await send(a);
  };
  const send = async (a: number, resend = false) => {
    setErr(null); setBusy(true);
    try { await kw.withdraw(token, company, a, acc, !resend && ask ? tf : undefined, resend || undefined); setAmount(''); setOpen(false); setAsk(null); setTf(''); onDone(); }
    catch (er) { const x = codeAsk(er); if (x) { setAsk(x); setTf(''); } else setErr(er instanceof ApiError ? er.message : 'Não foi possível.'); }
    finally { setBusy(false); }
  };
  const complain = async (id: string) => {
    setClaimErr(null); setBusy(true);
    try { await kw.complainWithdrawal(token, id, claimTx.trim() || undefined); setClaim(null); setClaimTx(''); onDone(); }
    catch (er) { setClaimErr(er instanceof ApiError ? er.message : 'Não foi possível.'); } finally { setBusy(false); }
  };
  const banks = cur?.banks ?? [];
  const sameBank = (a: PayoutAccount) => !!a.bank && banks.some((b) => b.toLowerCase() === a.bank!.toLowerCase());
  return (
    <div className="kk-dash">
      <div className="kk-kpis">
        <Kpi tone="main" label="Saldo disponível" value={kz(d.balance)} />
        <Kpi label="Vendas em processo" value={kz(d.pending)} />
        <Kpi tone="warn" label="Saque em análise" value={kz(d.requested)} />
        <Kpi tone="ok" label="Total já retirado" value={kz(d.withdrawn)} />
      </div>
      <button className="kk-btn-green" onClick={() => setOpen((o) => !o)}>FAZER SAQUES</button>
      {open ? (
        <Sec title="Fazer saque">
          <form className="kw-form2" onSubmit={(e) => void submit(e)}>
            <label className="kw-f"><span>Empresa que paga</span><select value={company} onChange={(e) => setCompany(e.target.value)}><option value="">Escolha</option>{d.companies.map((c) => <option key={c.companyCode} value={c.companyCode}>{c.companyName} — {kz(c.balance)}</option>)}</select></label>
            <label className="kw-f"><span>Valor (Kz)</span><div className="kw-amt"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" />{cur && cur.balance > 0 ? <button type="button" onClick={() => setAmount(String(cur.balance))}>Tudo</button> : null}</div></label>
            {banks.length ? <div className="kw-f kw-f-wide"><span>Bancos de {cur?.companyName}</span><div className="kw-banks">{banks.map((b) => <span key={b} className={`kw-bank${accs?.some((a) => a.bank?.toLowerCase() === b.toLowerCase()) ? ' have' : ''}`}>{b}</span>)}</div></div> : null}
            <div className="kw-f kw-f-wide"><span>Conta para receber</span>{accs && accs.length ? <div className="kw-acc-pick">{accs.map((a) => <label key={a.id} className={`kw-acc-opt${acc === a.id ? ' on' : ''}`}><input type="radio" name="acc" checked={acc === a.id} onChange={() => setAcc(a.id)} /><span><b>{a.method}{a.bank ? ` · ${a.bank}` : ''}</b><small>{a.details} · {a.holder}</small>{sameBank(a) ? <em className="kw-same">Mesmo banco · recebe na hora</em> : null}</span></label>)}</div> : <button type="button" className="kk-ghost" onClick={() => go({ n: 'accounts' })}>+ Registar conta bancária</button>}</div>
            {ask ? <div className="kw-f kw-f-wide"><CodeBox ask={ask} code={tf} setCode={setTf} busy={busy} onResend={() => void send(Number(amount.replace(',', '.')), true)} onEnter={() => void send(Number(amount.replace(',', '.')))} /></div> : null}
            {frozenWhy !== undefined && !err ? <div className="kw-err kw-f-wide" role="alert">Saldo congelado por esta empresa: {frozenWhy}</div> : null}
            {err ? <div className="kw-err kw-f-wide" role="alert">{err}</div> : null}
            <div className="kw-f-wide kw-form-act"><button className="kk-btn-primary" disabled={busy || !accs?.length || !d.balance || (!!ask && tf.length !== 6)}>{busy ? 'A enviar…' : ask ? 'Confirmar saque' : 'Pedir saque'}</button></div>
          </form>
        </Sec>
      ) : null}
      {!d.withdrawals.length ? <div className="kk-empty">Sem transações</div> : (
        <div className="kk-rows">
          {d.withdrawals.map((w) => {
            const waiting = w.status === 'REQUESTED';
            const limit = w.extendedUntil ?? w.dueAt;
            const left = waiting && limit ? leftText(limit, now) : null;
            const late = waiting && !!w.dueAt && !left;
            return (
              <div className={`kk-sale kw-wd${late ? ' late' : ''}`} key={w.id}>
                <div className="kk-sale-m"><b>{w.companyName}</b><small>{w.method}{w.details ? ` · ${w.details}` : ''} · {formatDateTime(w.date)}</small>{w.note ? <small className={w.status === 'REJECTED' || (waiting && w.postponedAt) ? 'kw-reason' : undefined}>{w.status === 'REJECTED' ? `Motivo da recusa: ${w.note}` : waiting && w.postponedAt ? `Motivo do adiamento: ${w.note}` : w.note}</small> : null}
                  {waiting ? (
                    <div className="kw-sla">
                      {w.escalation === 'OPEN' ? <span className="kw-sla-chip esc">Reclamação enviada à equipa LPS Kwanza</span>
                        : w.escalation === 'NOTIFIED' ? <span className="kw-sla-chip esc">Empresa avisada{left ? ` · ${left} para pagar` : ''}</span>
                        : left ? <span className="kw-sla-chip">{w.postponedAt ? 'Adiado pela empresa' : 'Prazo da empresa'} · {left}</span> : <span className="kw-sla-chip late">Prazo ultrapassado</span>}
                      {(late || w.postponedAt) && !w.escalation ? <button type="button" className="kw-sla-btn" onClick={() => { setClaim(w.id); setClaimErr(null); }}>{w.postponedAt && !late ? 'Contestar o adiamento' : 'Reclamar'}</button> : null}
                    </div>
                  ) : null}
                  {w.status === 'REJECTED' ? (
                    <div className="kw-sla">
                      {w.escalation === 'OPEN' ? <span className="kw-sla-chip esc">Contestação enviada à equipa LPS Kwanza</span>
                        : w.escalation === 'NOTIFIED' ? <span className="kw-sla-chip esc">A equipa LPS Kwanza avisou a empresa</span>
                        : w.escalation === 'RESOLVED' ? <span className="kw-sla-chip">Contestação encerrada</span>
                        : <button type="button" className="kw-sla-btn" onClick={() => { setClaim(w.id); setClaimErr(null); setClaimTx(''); }}>Contestar a recusa</button>}
                    </div>
                  ) : null}
                  {w.status === 'REFUNDED' ? <small className="kw-sla-ok">Reembolsado pela equipa LPS Kwanza{w.refundRef ? ` · ref. ${w.refundRef}` : ''}</small> : null}
                  {claim === w.id ? (
                    <div className="kw-claim">
                      <textarea rows={2} maxLength={600} value={claimTx} onChange={(e) => setClaimTx(e.target.value)} placeholder={d.withdrawals.find((x) => x.id === claim)?.status === 'REJECTED' ? 'Porque não concorda com a recusa?' : 'Descreva o que aconteceu'} aria-label="Reclamação" />
                      {claimErr ? <div className="kw-err">{claimErr}</div> : null}
                      <div className="kw-tf-act"><button type="button" className="kw-btn" onClick={() => setClaim(null)}>Cancelar</button><button type="button" className="kw-btn kw-btn-primary" disabled={busy} onClick={() => void complain(w.id)}>Enviar reclamação</button></div>
                    </div>
                  ) : null}
                </div>
                <div className="kk-sale-r"><b>{kz(w.amount)}</b><span className={`kw-pill ${STATE[w.status]?.[1] ?? ''}`}>{STATE[w.status]?.[0] ?? w.status}</span>{w.proofUrl ? <a className="kw-link kw-proof" href={w.proofUrl} target="_blank" rel="noopener noreferrer" download={`comprovativo-${w.id}`}>Comprovativo</a> : null}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Affs({ token, go, flash }: { token: string; go(r: Route): void; flash(t: string): void }) {
  const [rows, setRows] = useState<Affiliation[] | null>(null);
  const [editing, setEditing] = useState<Affiliation | null>(null);
  const [f, setF] = useState<'ALL' | 'APPROVED' | 'PENDING' | 'REJECTED'>('ALL');
  const [q, setQ] = useState('');
  useEffect(() => { kw.affiliations(token).then(setRows).catch(() => setRows([])); }, [token]);
  if (!rows) return <Loader />;
  const count = (st?: string) => rows.filter((a) => !st || a.status === st).length;
  const term = q.trim().toLowerCase();
  const list = rows.filter((a) => (f === 'ALL' || a.status === f) && (!term || `${a.name} ${a.companyName}`.toLowerCase().includes(term)));
  const tabs: Array<[typeof f, string]> = [['ALL', 'Todas'], ['APPROVED', 'Aprovadas'], ['PENDING', 'Pendentes'], ['REJECTED', 'Recusadas']];
  return (
    <div className="kw-dash kw-sales">
      <div className="kw-sales-kpis">
        <Kpi tone="main" label="Produtos afiliados" value={String(count())} />
        <Kpi tone="ok" label="Aprovadas" value={String(count('APPROVED'))} />
        <Kpi tone="warn" label="Pendentes" value={String(count('PENDING'))} />
        <Kpi tone="off" label="Recusadas" value={String(count('REJECTED'))} />
      </div>
      <div className="kw-sales-bar">
        <div className="kw-sales-tabs" role="tablist" aria-label="Estado">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={f === k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}<em>{count(k === 'ALL' ? undefined : k)}</em></button>)}
        </div>
        <label className="kw-sales-q"><I d={P.search} size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar produto ou empresa" aria-label="Pesquisar afiliações" /></label>
      </div>
      {!list.length ? (
        <div className="kw-empty"><p>{rows.length ? 'Nenhuma afiliação neste filtro' : 'Ainda não se associou a nenhum produto'}</p>{rows.length ? null : <button className="kw-btn kw-btn-primary" onClick={() => go({ n: 'search', s: { q: '' } })}>Ver mercado</button>}</div>
      ) : (
        <div className="kw-sales-list kw-list">
          <div className="kw-row kw-row-aff head" aria-hidden="true"><span>Produto</span><span className="r">Preço</span><span className="r">Comissão</span><span className="c">Estado</span><span /></div>
          {list.map((a) => (
            <div className="kw-row kw-row-aff" key={a.id}>
              <button className="kw-row-prod" onClick={() => go({ n: 'product', c: a.companyCode, p: a.productCode })}>
                <span className="kw-row-pic">{a.imageUrl ? <img src={a.imageUrl} alt="" /> : null}</span>
                <span className="kw-row-main"><b>{a.name}</b><small>{a.companyName}{a.markupPct ? ` · preço próprio +${a.markupPct}%` : ''}</small></span>
              </button>
              <div className="r"><small className="lbl">Preço</small>{kz(a.price ?? a.grossPrice)}{a.price > a.grossPrice ? <small className="kw-muted"> base {kz(a.grossPrice)}</small> : null}</div>
              <div className="r"><small className="lbl">Comissão</small><b className="kw-blue">{kz(Math.round(a.grossPrice * a.commissionPct) / 100)}</b><small className="kw-muted"> {a.commissionPct}%{a.negotiated ? ' · negociada' : ''}</small></div>
              <div className="c">{a.status === 'APPROVED' && a.published ? <span className="kw-pill kw-st-SHIPPED">Publicado</span> : <span className={`kw-pill ${STATE[a.status][1]}`}>{STATE[a.status][0]}</span>}</div>
              <div className="r">{a.status === 'APPROVED' ? <button className={`kw-btn kw-btn-sm${a.published ? '' : ' kw-btn-primary'}`} onClick={() => setEditing(a)}>{a.published ? 'Editar' : 'Publicar'}</button> : <button className="kw-btn kw-btn-sm" onClick={() => go({ n: 'product', c: a.companyCode, p: a.productCode })}>Ver</button>}</div>
            </div>
          ))}
        </div>
      )}
      {editing ? <PostEditor token={token} a={editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); flash(m); void kw.affiliations(token).then(setRows); }} /> : null}
    </div>
  );
}

const BANKS = ['BFA', 'BAI', 'BIC', 'Millennium Atlântico', 'Standard Bank', 'BCI', 'BPC', 'BNI', 'Banco Económico', 'Banco Sol', 'Banco Keve', 'Banco Yetu', 'Outro'];
function Accounts({ token, flash }: { token: string; flash(t: string): void }) {
  const [rows, setRows] = useState<PayoutAccount[] | null>(null);
  const [f, setF] = useState({ method: 'Transferência bancária', bank: '', holder: '', details: '' }); const [err, setErr] = useState<string | null>(null);
  const load = () => kw.accounts(token).then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e: React.FormEvent) => { e.preventDefault(); setErr(null); try { await kw.addAccount(token, { ...f, bank: f.method === 'Multicaixa Express' ? undefined : f.bank }); setF({ ...f, holder: '', details: '' }); void load(); flash('Conta registada'); } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível.'); } };
  const n = rows?.length ?? 0;
  return (
    <div className="kw-dash kw-sales">
      <div className="kw-warn">Os dados bancários têm de estar em seu nome.</div>
      <Sec title="Contas registadas">
        {rows === null ? <Loader /> : !rows.length ? <div className="kw-empty">Sem contas</div> : (
          <div className="kw-acc-grid">
            {rows.map((a) => (
              <div className="kw-acc-card" key={a.id}>
                <span className="kw-acc-ic"><I d={a.method === 'Multicaixa Express' ? P.phone : P.card} size={18} /></span>
                <div className="kw-row-main"><b>{a.method}{a.bank ? ` · ${a.bank}` : ''}</b><small>{a.details}</small><small>{a.holder}</small></div>
                <button className="kw-x" aria-label="Eliminar conta" title="Eliminar conta" onClick={() => { if (window.confirm('Eliminar esta conta?')) void kw.removeAccount(token, a.id).then(load); }}><I d={P.trash} size={17} /></button>
              </div>
            ))}
          </div>
        )}
      </Sec>
      {n < 3 ? (
        <Sec title="Nova conta">
          <form className="kw-form2" onSubmit={(e) => void add(e)}>
            <label className="kw-f"><span>Receber por</span><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option>Transferência bancária</option><option>Multicaixa Express</option></select></label>
            {f.method !== 'Multicaixa Express' ? <label className="kw-f"><span>Banco</span><select value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })}><option value="">Escolha o banco</option>{BANKS.map((b) => <option key={b}>{b}</option>)}</select></label> : null}
            <label className="kw-f"><span>Titular</span><input value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} /></label>
            <label className="kw-f"><span>{f.method === 'Multicaixa Express' ? 'Número de telefone' : 'IBAN'}</span><input value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></label>
            {err ? <div className="kw-err kw-f-wide">{err}</div> : null}
            <div className="kw-f-wide kw-form-act"><button className="kw-btn kw-btn-primary">Registar conta</button></div>
          </form>
        </Sec>
      ) : null}
    </div>
  );
}

function Profile({ token, me, flash }: { token: string; me: Associate; flash(t: string): void }) {
  const [f, setF] = useState({ name: me.name, email: me.email ?? '', taxId: me.taxId ?? '', province: me.province ?? '', municipality: me.municipality ?? '', address: me.address ?? '', bio: me.bio ?? '' });
  const [photo, setPhoto] = useState<string | null>(me.photoUrl);
  const [pw, setPw] = useState({ current: '', next: '' }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [pwAsk, setPwAsk] = useState<CodeAsk | null>(null); const [pwCode, setPwCode] = useState(''); const [pwErr, setPwErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const pick = (file?: File) => { if (!file) return; if (file.size > 1_000_000) { setErr('Imagem demasiado grande (máx. 1 MB).'); return; } void readFileProgress(file).then(setPhoto); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const a = await kw.saveProfile(token, { ...f, photoUrl: photo }); const s = session.get(); if (s) session.set({ ...s, associate: a }); flash('Perfil guardado'); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível guardar.'); } finally { setBusy(false); }
  };
  const changePw = async (e?: React.FormEvent) => {
    e?.preventDefault(); setPwErr(null);
    try { await kw.password(token, pw.current, pw.next, pwAsk ? pwCode : undefined); setPw({ current: '', next: '' }); setPwAsk(null); setPwCode(''); flash('Senha alterada'); }
    catch (er) { const a = codeAsk(er); if (a) { setPwAsk(a); setPwCode(''); } else setPwErr(er instanceof ApiError ? er.message : 'Não foi possível.'); }
  };
  return (
    <div className="kw-dash kw-sales">
      <div className="kw-hello">
        <span className="kw-hello-ph big">{photo ? <img src={photo} alt="" /> : <b>{me.name.slice(0, 1).toUpperCase()}</b>}</span>
        <div><strong>{me.name}</strong><small>Código {me.code} · {me.phone}</small></div>
        <div className="kw-hello-acts">
          <label className="kw-btn kw-hello-btn" style={{ cursor: 'pointer' }}>{photo ? 'Trocar foto' : 'Carregar foto'}<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
          {photo ? <button type="button" className="kw-btn kw-hello-ghost" onClick={() => setPhoto(null)}>Remover</button> : null}
        </div>
      </div>
      <Sec title="Dados pessoais">
        <form className="kw-form2" onSubmit={(e) => void save(e)}>
          <label className="kw-f"><span>Nome completo</span><input value={f.name} onChange={set('name')} /></label>
          <label className="kw-f"><span>Email</span><input type="email" value={f.email} onChange={set('email')} /></label>
          <label className="kw-f"><span>NIF / BI</span><input value={f.taxId} onChange={set('taxId')} /></label>
          <label className="kw-f"><span>Província</span><input value={f.province} onChange={set('province')} /></label>
          <label className="kw-f"><span>Município</span><input value={f.municipality} onChange={set('municipality')} /></label>
          <label className="kw-f"><span>Endereço</span><input value={f.address} onChange={set('address')} /></label>
          <label className="kw-f kw-f-wide"><span>Sobre mim</span><textarea value={f.bio} onChange={set('bio')} rows={3} maxLength={400} /></label>
          {err ? <div className="kw-err kw-f-wide">{err}</div> : null}
          <div className="kw-f-wide kw-form-act"><button className="kw-btn kw-btn-primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar perfil'}</button></div>
        </form>
      </Sec>
      <Sec title="Segurança">
        <form className="kw-form2" onSubmit={(e) => void changePw(e)}>
          <label className="kw-f"><span>Senha atual</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
          <label className="kw-f"><span>Nova senha</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
          {pwAsk ? <div className="kw-f-wide"><CodeBox ask={pwAsk} code={pwCode} setCode={setPwCode} onResend={() => void kw.twoFa.code(token).catch(() => undefined)} onEnter={() => void changePw()} /></div> : null}
          {pwErr ? <div className="kw-err kw-f-wide">{pwErr}</div> : null}
          <div className="kw-f-wide kw-form-act"><button className="kw-btn kw-btn-primary" disabled={!!pwAsk && pwCode.length !== 6}>{pwAsk ? 'Confirmar código' : 'Mudar senha'}</button></div>
        </form>
        <TwoFaCard token={token} email={me.email} phone={me.phone} />
      </Sec>
    </div>
  );
}
