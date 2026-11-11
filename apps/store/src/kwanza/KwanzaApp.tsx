import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../members/members.css';
import { ApiError } from '../api/client';
import type { CatalogProduct } from '../api/types';
import { formatDateTime } from '../format';
import { readFileProgress } from '../transfer';
import { BRAND, Card, Carousel, I, Mark, P, Pic, Shelf, type Slide, kz, useInfinite, useReveal } from '../members/parts';
import { Search, type SearchState } from '../members/Search';
import { Messages, NotesBell } from './Inbox';
import { kw, session, shareLink, type Affiliation, type Associate, type Dashboard, type Listing, type PayoutAccount } from './api';

/** Produto do marketplace no formato dos cartões (código = empresa::produto). */
type MP = CatalogProduct & { listing: Listing };
const toMP = (l: Listing): MP => ({
  code: `${l.companyCode}::${l.productCode}`, name: l.name, description: l.description, ivaCode: '' as never, netPrice: l.grossPrice, grossPrice: l.grossPrice,
  inStock: l.inStock, imageUrl: l.imageUrl, gallery: l.gallery, category: l.category, listPrice: l.listPrice ?? undefined,
  promo: l.listPrice && l.listPrice > l.grossPrice ? { name: 'Promoção', percent: Math.round((1 - l.grossPrice / l.listPrice) * 100), endsAt: null } : undefined,
  sold: l.sold, views: l.views, listing: l,
});
const com = (l: Listing, pct?: number) => Math.round(l.grossPrice * (pct ?? l.commissionPct)) / 100;

type Route =
  | { n: 'home' } | { n: 'search'; s: SearchState } | { n: 'product'; c: string; p: string }
  | { n: 'login' } | { n: 'register' } | { n: 'recover' }
  | { n: 'panel' } | { n: 'sales' } | { n: 'affs' } | { n: 'withdraw' } | { n: 'accounts' } | { n: 'profile' } | { n: 'msgs'; c?: string };
const parse = (h: string): Route => {
  const [path, qs] = h.replace(/^#\/?/, '').split('?'); const s = path.split('/').filter(Boolean).map(decodeURIComponent); const q = new URLSearchParams(qs ?? '');
  switch (s[0]) {
    case 'busca': return { n: 'search', s: { q: q.get('q') ?? '', cat: q.get('cat') ?? undefined, promo: q.get('promo') === '1' } };
    case 'p': return s[1] && s[2] ? { n: 'product', c: s[1], p: s[2] } : { n: 'home' };
    case 'entrar': return { n: 'login' }; case 'registar': return { n: 'register' }; case 'recuperar': return { n: 'recover' };
    case 'painel': return { n: 'panel' }; case 'vendas': return { n: 'sales' }; case 'afiliacoes': return { n: 'affs' };
    case 'saques': return { n: 'withdraw' }; case 'contas': return { n: 'accounts' }; case 'perfil': return { n: 'profile' };
    case 'mensagens': return { n: 'msgs', c: s[1] || undefined };
    default: return { n: 'home' };
  }
};
const hashOf = (r: Route): string => {
  switch (r.n) {
    case 'search': { const q = new URLSearchParams(); if (r.s.q) q.set('q', r.s.q); if (r.s.cat) q.set('cat', r.s.cat); if (r.s.promo) q.set('promo', '1'); const x = q.toString(); return `#/busca${x ? `?${x}` : ''}`; }
    case 'product': return `#/p/${encodeURIComponent(r.c)}/${encodeURIComponent(r.p)}`;
    case 'login': return '#/entrar'; case 'register': return '#/registar'; case 'recover': return '#/recuperar';
    case 'panel': return '#/painel'; case 'sales': return '#/vendas'; case 'affs': return '#/afiliacoes'; case 'withdraw': return '#/saques'; case 'accounts': return '#/contas'; case 'profile': return '#/perfil';
    case 'msgs': return r.c ? `#/mensagens/${encodeURIComponent(r.c)}` : '#/mensagens';
    default: return '#/';
  }
};
const PRIVATE = new Set(['panel', 'sales', 'affs', 'withdraw', 'accounts', 'profile', 'msgs']);

export function KwanzaApp() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [sess, setSess] = useState(() => session.get());
  const [list, setList] = useState<Listing[] | null>(null);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ id: number; t: string } | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => { const on = () => setRoute(parse(location.hash)); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => { const on = () => setSess(session.get()); window.addEventListener('kwanza:session', on); return () => window.removeEventListener('kwanza:session', on); }, []);
  useEffect(() => { const on = () => setCompact(window.scrollY > 60); on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on); }, []);
  useEffect(() => { kw.market().then(setList).catch(() => setList([])); }, []);
  useEffect(() => { document.title = 'LPS Kwanza'; }, []);
  const go = useCallback((r: Route) => { const h = hashOf(r); if (location.hash === h) setRoute(r); else location.hash = h; window.scrollTo({ top: 0 }); }, []);
  const flash = useCallback((t: string) => { const id = Date.now(); setToast({ id, t }); window.setTimeout(() => setToast((x) => (x?.id === id ? null : x)), 2600); }, []);
  const products = useMemo(() => (list ?? []).map(toMP), [list]);
  const open = (p: CatalogProduct) => { const [c, pc] = p.code.split('::'); go({ n: 'product', c, p: pc }); };
  const card = (p: CatalogProduct, hot?: boolean) => <Card p={p} cod={false} hot={hot} onOpen={() => open(p)} onAdd={() => open(p)} />;
  // Sessão expirada → volta a entrar.
  useEffect(() => { if (sess) kw.me(sess.token).catch((e) => { if (e instanceof ApiError && e.status === 401) session.clear(); }); }, [sess?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const needLogin = PRIVATE.has(route.n) && !sess;
  let body: React.ReactNode;
  if (needLogin || route.n === 'login') body = <Login onDone={() => go(route.n === 'login' ? { n: 'panel' } : route)} go={go} />;
  else if (route.n === 'register') body = <Register onDone={() => go({ n: 'panel' })} go={go} />;
  else if (route.n === 'recover') body = <Recover go={go} flash={flash} />;
  else if (route.n === 'search') body = list === null ? <Loader /> : <Search products={products} state={route.s} card={card} onState={(s) => go({ n: 'search', s })} />;
  else if (route.n === 'product') body = <Product listing={list?.find((l) => l.companyCode === route.c && l.productCode === route.p) ?? null} loading={list === null} sess={sess} go={go} flash={flash} card={card} products={products} />;
  else if (PRIVATE.has(route.n) && sess) body = <Area route={route.n as AreaTab} chat={route.n === 'msgs' ? route.c : undefined} go={go} token={sess.token} me={sess.associate} flash={flash} products={products} />;
  else body = <Home products={list === null ? null : products} go={go} card={card} />;

  return (
    <div className="kw-root">
      <header className={`kw-head${compact ? ' compact' : ''}`}>
        <div className="kw-strip">
          <div className="kw-container kw-strip-in">
            <span className="kw-strip-l"><button onClick={() => go({ n: sess ? 'panel' : 'register' })}>Central do Associado</button></span>
            <span className="kw-strip-r">
              {sess ? <button className="kw-strip-me" onClick={() => go({ n: 'panel' })}>{sess.associate.photoUrl ? <img src={sess.associate.photoUrl} alt="" className="kw-strip-ph" /> : <i>{sess.associate.name.slice(0, 1).toUpperCase()}</i>}<span>{sess.associate.name.split(' ')[0]}</span></button>
                : <><button onClick={() => go({ n: 'register' })}><span>Criar conta</span></button><button onClick={() => go({ n: 'login' })}><I d={P.user} size={15} /><span>Entrar</span></button></>}
            </span>
          </div>
        </div>
        <div className="kw-container kw-head-in">
          <button className="kw-logo" onClick={() => go({ n: 'home' })} aria-label={BRAND}><Mark size={40} /><span><b>LPS</b> Kwanza</span></button>
          <form className="kw-search" role="search" onSubmit={(e) => { e.preventDefault(); go({ n: 'search', s: { q: q.trim() } }); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produtos, marcas e muito mais…" aria-label="Pesquisar" />
            <button aria-label="Pesquisar"><I d={P.search} size={18} /></button>
          </form>
          {sess ? <button className="kw-head-ic" onClick={() => go({ n: 'msgs' })} aria-label="Mensagens"><I d={P.chat} size={23} /></button> : null}
          {sess ? <NotesBell token={sess.token} /> : null}
          <button className="kw-head-ic" onClick={() => go({ n: sess ? 'panel' : 'login' })} aria-label="Conta"><I d={P.user} size={24} /></button>
        </div>
      </header>
      <main className="kw-main" key={hashOf(route)}>{body}</main>
      {toast ? <div key={toast.id} className="kw-toast" role="status"><span className="kw-toast-ic"><I d={P.check} size={16} /></span>{toast.t}<i className="kw-toast-bar" /></div> : null}
      <footer className="kw-foot">
        <div className="kw-container kw-foot-in">
          <div><h4>{BRAND}</h4><button onClick={() => go({ n: 'home' })}>Marketplace</button><button onClick={() => go({ n: 'search', s: { q: '' } })}>Todos os produtos</button></div>
          <div><h4>Associados</h4><button onClick={() => go({ n: sess ? 'panel' : 'register' })}>Central do Associado</button><button onClick={() => go({ n: 'affs' })}>Minhas afiliações</button><button onClick={() => go({ n: 'withdraw' })}>Transações (Saques)</button></div>
          <div><h4>Conta</h4><button onClick={() => go({ n: 'profile' })}>Perfil</button><button onClick={() => go({ n: 'recover' })}>Recuperar senha</button></div>
          <div><h4>Empresas</h4><span>{new Set((list ?? []).map((l) => l.companyCode)).size} empresas · {(list ?? []).length} produtos</span></div>
        </div>
        <div className="kw-foot-copy">© {new Date().getFullYear()} {BRAND} TODOS OS DIREITOS RESERVADOS</div>
      </footer>
    </div>
  );
}

const Loader = () => <div className="kw-container"><div className="kw-loader" aria-busy="true"><i /><i /><i /></div></div>;

/* ───────────── início do marketplace ───────────── */
function Home({ products, go, card }: { products: MP[] | null; go(r: Route): void; card(p: CatalogProduct, hot?: boolean): React.ReactNode }) {
  const list = products ?? [];
  const cats = useMemo(() => { const m = new Map<string, { n: number; img: MP }>(); for (const p of list) if (p.category) { const c = m.get(p.category); if (c) c.n++; else m.set(p.category, { n: 1, img: p }); } return [...m.entries()].sort((a, b) => b[1].n - a[1].n); }, [list]);
  const best = useMemo(() => [...list].sort((a, b) => com(b.listing) - com(a.listing)).slice(0, 12), [list]);
  const top = useMemo(() => [...list].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0)).slice(0, 12), [list]);
  const companies = useMemo(() => { const m = new Map<string, { name: string; n: number; img: MP }>(); for (const p of list) { const c = m.get(p.listing.companyCode); if (c) c.n++; else m.set(p.listing.companyCode, { name: p.listing.companyName, n: 1, img: p }); } return [...m.entries()]; }, [list]);
  const rest = useMemo(() => list.filter((p) => !top.includes(p)), [list, top]);
  const [shown, sentinel] = useInfinite(rest.length, 20, rest.length);
  useReveal(`${list.length}-${shown}`);
  const slides: Slide[] = useMemo(() => {
    const s: Slide[] = [];
    if (best[0]) s.push({ id: 'b', title: 'Ganhe a vender', subtitle: `Comissões até ${kz(com(best[0].listing))} por venda`, image: best[0].imageUrl, cta: 'Ver produtos', tone: 0, onClick: () => go({ n: 'search', s: { q: '' } }) });
    for (const [code, c] of companies.slice(0, 3)) s.push({ id: `c-${code}`, title: c.name, subtitle: `${c.n} produtos`, image: c.img.imageUrl, cta: 'Ver', tone: s.length, onClick: () => go({ n: 'search', s: { q: c.name } }) });
    return s;
  }, [best, companies, go]);
  if (products === null) return <Loader />;
  if (!list.length) return <div className="kw-container kw-empty">Ainda sem produtos no marketplace</div>;
  return (
    <>
      <div className="kw-herowrap">
        <section className="kw-container kw-hero">
          <div className={`kw-hero-grid${slides.length > 2 ? '' : ' one'}`}>
            <Carousel slides={slides.slice(0, Math.max(1, slides.length - 2))} className="kw-hero-main" />
            {slides.length > 2 ? <div className="kw-hero-side">{slides.slice(-2).map((s) => <button key={s.id} className={`kw-slide kw-side tone-${s.tone % 4}`} onClick={s.onClick}>{s.image ? <img src={s.image} alt="" loading="lazy" /> : null}<span className="kw-slide-txt"><strong>{s.title}</strong>{s.subtitle ? <small>{s.subtitle}</small> : null}</span></button>)}</div> : null}
          </div>
          {cats.length ? (
            <div className="kw-circles"><div className="kw-circles-track">
              {cats.map(([name, c]) => <button key={name} className="kw-circle" onClick={() => go({ n: 'search', s: { q: '', cat: name } })}><span className="kw-circle-img"><Pic p={c.img} /></span><span className="kw-circle-lbl">{name}</span></button>)}
            </div></div>
          ) : null}
        </section>
      </div>
      <div className="kw-container kw-stack">
        <Shelf className="kw-flash" title="MAIS COMISSÃO" items={best} render={(p) => card(p)}
          head={<header className="kw-flash-head"><h2><I d={P.bolt} size={20} /> MAIS COMISSÃO</h2><button className="kw-flash-all" onClick={() => go({ n: 'search', s: { q: '' } })}>Ver tudo <I d={P.next} size={14} /></button></header>} />
        {companies.length > 1 ? (
          <section className="kw-sec kw-reveal"><header className="kw-sec-head"><h2>EMPRESAS</h2></header>
            <div className="kw-catgrid">{companies.map(([code, c]) => <button key={code} className="kw-cat" onClick={() => go({ n: 'search', s: { q: c.name } })}><span className="kw-cat-img"><Pic p={c.img} /></span><span className="kw-cat-lbl">{c.name}</span></button>)}</div>
          </section>
        ) : null}
        <Shelf title="DESTAQUE" items={top} render={(p) => card(p, true)} />
        <section className="kw-disc"><header className="kw-disc-head"><h2>DESCOBERTAS DO DIA</h2></header>
          <div className="kw-grid6">{rest.slice(0, shown).map((p) => <div key={p.code} className="kw-reveal">{card(p)}</div>)}</div>
          {shown < rest.length ? <div ref={sentinel} className="kw-loader" aria-busy="true"><i /><i /><i /></div> : null}
        </section>
      </div>
    </>
  );
}

/* ───────────── produto do marketplace ───────────── */
function Product({ listing: l, loading, sess, go, flash, card, products }: { listing: Listing | null; loading: boolean; sess: ReturnType<typeof session.get>; go(r: Route): void; flash(t: string): void; card(p: CatalogProduct): React.ReactNode; products: MP[] }) {
  const [img, setImg] = useState(0);
  const [aff, setAff] = useState<Affiliation | null | undefined>(undefined);
  const [mk, setMk] = useState('');
  const [busy, setBusy] = useState(false);
  const viewed = useRef(false);
  useEffect(() => { if (l && !viewed.current) { viewed.current = true; void kw.view(l.companyCode, l.productCode).catch(() => undefined); } }, [l]);
  useEffect(() => {
    if (!sess || !l) { setAff(null); return; }
    kw.affiliations(sess.token).then((r) => { const f = r.find((x) => x.companyCode === l.companyCode && x.productCode === l.productCode) ?? null; setAff(f); setMk(f?.markupPct ? String(f.markupPct) : ''); }).catch(() => setAff(null));
  }, [sess?.token, l?.companyCode, l?.productCode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Loader />;
  if (!l) return <div className="kw-container kw-empty">Produto indisponível</div>;
  const pics = [l.imageUrl, ...l.gallery].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  const pct = aff?.status === 'APPROVED' ? aff.commissionPct : l.commissionPct;
  const link = sess ? shareLink(l.companyCode, l.productCode, sess.associate.code) : '';
  const similar = products.filter((p) => p.listing.productCode !== l.productCode && p.category && p.category === l.category).slice(0, 12);
  const join = async () => {
    if (!sess) { go({ n: 'login' }); return; }
    setBusy(true);
    try { const r = await kw.affiliate(sess.token, l.companyCode, l.productCode); flash(r.status === 'APPROVED' ? 'Associado a este produto' : 'Pedido de afiliação enviado'); const all = await kw.affiliations(sess.token); setAff(all.find((x) => x.companyCode === l.companyCode && x.productCode === l.productCode) ?? null); }
    catch (e) { flash(e instanceof ApiError ? e.message : 'Não foi possível'); } finally { setBusy(false); }
  };
  const saveMk = async () => { if (!sess) return; try { const r = await kw.markup(sess.token, l.companyCode, l.productCode, mk ? Number(mk) : null); setMk(r.markupPct ? String(r.markupPct) : ''); flash('Preço próprio guardado'); } catch (e) { flash(e instanceof ApiError ? e.message : 'Não foi possível'); } };
  const copy = async () => { try { await navigator.clipboard.writeText(link); flash('Ligação copiada'); } catch { window.prompt('Copie:', link); } };
  return (
    <div className="kw-container kw-pdp">
      <div className="kw-pdp-grid">
        <div className="kw-pdp-main"><div className="kw-pdp-top">
          <div className="kw-gal">
            {pics.length > 1 ? <div className="kw-thumbs">{pics.map((u, i) => <button key={u} className={i === img ? 'on' : ''} onMouseEnter={() => setImg(i)} onClick={() => setImg(i)} aria-label={`Imagem ${i + 1}`}><img src={u} alt="" loading="lazy" /></button>)}</div> : null}
            <div className="kw-gal-main">{pics.length ? <img src={pics[img] ?? pics[0]} alt={l.name} /> : <Pic p={toMP(l)} />}</div>
          </div>
          <div className="kw-pdp-info">
            <h1>{l.name}</h1>
            <div className="kw-pdp-meta"><span className="kw-pill-soft"><I d={P.bag} size={14} /> {l.companyName}</span>{l.views ? <span className="kw-pill-soft"><I d={P.eye} size={14} /> {l.views}</span> : null}{l.affiliation === 'RESTRICTED' ? <span className="kw-pill kw-st-PENDING">Afiliação restrita</span> : null}</div>
            <div className="kw-pricebox"><div><b>{kz(l.grossPrice)}</b></div>{l.listPrice && l.listPrice > l.grossPrice ? <s>{kz(l.listPrice)}</s> : null}</div>
            <div className="kw-aff-modal-p"><div><span>Comissão de até</span><b className="kw-aff-com">{kz(com(l, pct))}</b></div><div><span>Comissionamento</span><b className="kw-aff-val">{pct}% · último clique</b></div></div>
            {l.description ? <p className="kw-desc">{l.description}</p> : null}
          </div>
        </div></div>
        <aside className="kw-pdp-side kw-pdp-side-on">
          <div className="kw-side-price"><b>{kz(l.grossPrice)}</b></div>
          <div className="kw-side-row">Vendido por: <b>{l.companyName}</b></div>
          {sess ? <button className="kw-btn kw-block" onClick={() => go({ n: 'msgs', c: l.companyCode })}><I d={P.chat} size={16} /> Falar com a empresa</button> : null}
          <a className="kw-btn kw-btn-outline kw-block" href={`${location.origin}/${encodeURIComponent(l.companyCode)}?p=${encodeURIComponent(l.productCode)}`}>Comprar na loja</a>
          {aff?.status === 'APPROVED' ? (
            <>
              <div className="kw-aff-link"><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Ligação de associado" /></div>
              <button className="kw-btn kw-btn-primary kw-block" onClick={() => void copy()}>Copiar ligação de associado</button>
              <a className="kw-btn kw-btn-green kw-block" href={`https://wa.me/?text=${encodeURIComponent(`${l.name} — ${kz(l.grossPrice)}\n${link}`)}`} target="_blank" rel="noopener noreferrer">Partilhar no WhatsApp</a>
              {aff.negotiated ? <span className="kw-pill kw-st-PAID">Comissão negociada: {aff.commissionPct}%</span> : null}
              {l.allowMarkup ? (
                <div className="kw-f"><span>Venda no teu preço (+% até {l.maxMarkupPct ?? 100}%)</span>
                  <div className="kw-price-range"><input inputMode="decimal" value={mk} onChange={(e) => setMk(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" aria-label="Acréscimo em %" /><button className="kw-btn" onClick={() => void saveMk()}>Guardar</button></div>
                  {mk ? <small className="kw-muted">Preço de venda: {kz(l.grossPrice * (1 + Number(mk) / 100))}</small> : null}
                </div>
              ) : null}
            </>
          ) : aff?.status === 'PENDING' ? <span className="kw-pill kw-st-PENDING">Pedido de afiliação em análise</span>
            : aff?.status === 'REJECTED' ? <span className="kw-pill kw-st-CANCELLED">Afiliação recusada</span>
            : <button className="kw-btn kw-btn-primary kw-block" disabled={busy} onClick={() => void join()}>{l.affiliation === 'RESTRICTED' ? 'Solicitar afiliação' : 'Associar-me'}</button>}
          {l.materials.length && aff?.status === 'APPROVED' ? <div className="kw-mats"><b>Materiais de divulgação</b>{l.materials.map((m, i) => <a key={m} href={m} target="_blank" rel="noopener noreferrer"><I d={P.doc} size={14} /> Material {i + 1}</a>)}</div> : null}
        </aside>
      </div>
      <Shelf title="Produtos similares" items={similar} render={card} />
    </div>
  );
}

/* ───────────── entrar / criar conta / recuperar ───────────── */
function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="kw-container kw-authwrap"><div className="kw-auth-card kw-pop"><div className="kw-auth-brand"><img src="/logo-mark.png" alt="LPS Vendas" width={120} height={120} /><strong>{BRAND}</strong></div><h2 className="kw-auth-t">{title}</h2>{children}</div></div>;
}
function Login({ onDone, go }: { onDone(): void; go(r: Route): void }) {
  const [login, setLogin] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr(null); setBusy(true); try { session.set(await kw.login({ login, password: pw })); onDone(); } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível entrar.'); } finally { setBusy(false); } };
  return (
    <AuthCard title="Entra com o teu telefone ou email">
      <form className="kw-auth-form" onSubmit={(e) => void submit(e)}>
        <label className="kw-f"><span>Telefone ou email</span><input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" /></label>
        <label className="kw-f"><span>Senha</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-primary kw-block" disabled={busy}>{busy ? 'Um momento…' : 'Entrar'}</button>
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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (step === 1) { await kw.recover(login); setStep(2); }
      else { await kw.recoverConfirm({ login, code, password: pw }); flash('Senha alterada'); go({ n: 'login' }); }
    } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível.'); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Recuperar a senha">
      <form className="kw-auth-form" onSubmit={(e) => void submit(e)}>
        <label className="kw-f"><span>Telefone ou email da conta</span><input value={login} onChange={(e) => setLogin(e.target.value)} disabled={step === 2} /></label>
        {step === 2 ? (
          <>
            <label className="kw-f"><span>Código recebido por email</span><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></label>
            <label className="kw-f"><span>Nova senha</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
          </>
        ) : null}
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-primary kw-block" disabled={busy}>{busy ? 'Um momento…' : step === 1 ? 'Enviar código' : 'Guardar nova senha'}</button>
        <div className="kw-auth-links"><button type="button" className="kw-link" onClick={() => go({ n: 'login' })}>Voltar a entrar</button></div>
      </form>
    </AuthCard>
  );
}

/* ───────────── área do associado ───────────── */
type AreaTab = 'panel' | 'sales' | 'affs' | 'withdraw' | 'accounts' | 'profile' | 'msgs';
const STATE: Record<string, [string, string]> = { PENDING: ['Pendente', 'kw-st-PENDING'], AVAILABLE: ['Disponível', 'kw-st-PAID'], CANCELLED: ['Cancelada', 'kw-st-CANCELLED'], APPROVED: ['Aprovada', 'kw-st-PAID'], REJECTED: ['Recusada', 'kw-st-CANCELLED'], REQUESTED: ['Em análise', 'kw-st-PENDING'], PAID: ['Pago', 'kw-st-PAID'] };

function Area({ route, chat, go, token, me, flash, products }: { route: AreaTab; chat?: string; go(r: Route): void; token: string; me: Associate; flash(t: string): void; products: MP[] }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [drawer, setDrawer] = useState(false);
  const load = useCallback(() => kw.dashboard(token).then(setD).catch(() => undefined), [token]);
  useEffect(() => { void load(); }, [load]);
  const menu = (
    <nav className="kw-affmenu" aria-label="Área do associado">
      <div className="kw-affmenu-g">VENDAS 🔥</div>
      {([['panel', 'Painel do associado', P.grid], ['sales', 'Minhas Vendas', P.card], ['affs', 'Minhas afiliações', P.share], ['withdraw', 'Transações (Saques)', P.box]] as const).map(([k, l, ic]) => <button key={k} className={route === k ? 'on' : ''} onClick={() => go({ n: k })}><I d={ic} size={17} /> {l}</button>)}
      <button onClick={() => go({ n: 'search', s: { q: '' } })}><I d={P.bag} size={17} /> Mercado de Associados <em>Venda +</em></button>
      <button className={route === 'msgs' ? 'on' : ''} onClick={() => go({ n: 'msgs' })}><I d={P.chat} size={17} /> Mensagens</button>
      <div className="kw-affmenu-g">CONTA</div>
      <button className={route === 'accounts' ? 'on' : ''} onClick={() => go({ n: 'accounts' })}><I d={P.shield} size={17} /> Contas bancárias</button>
      <button className={route === 'profile' ? 'on' : ''} onClick={() => go({ n: 'profile' })}><I d={P.user} size={17} /> Perfil</button>
      <button onClick={() => { session.clear(); go({ n: 'home' }); }}><I d={P.out} size={17} /> Terminar sessão</button>
    </nav>
  );
  let body: React.ReactNode;
  if (route === 'panel') body = <Panel d={d} me={me} go={go} products={products} />;
  else if (route === 'sales') body = <SalesT d={d} />;
  else if (route === 'affs') body = <Affs token={token} go={go} />;
  else if (route === 'withdraw') body = <Withdraw token={token} d={d} onDone={() => { void load(); flash('Pedido de saque enviado'); }} go={go} />;
  else if (route === 'accounts') body = <Accounts token={token} flash={flash} />;
  else if (route === 'msgs') body = <MsgsRoute token={token} chat={chat} go={go} />;
  else body = <Profile token={token} me={me} flash={flash} />;
  return (
    <div className="kw-container kw-affwrap">
      <aside className="kw-affside">{menu}</aside>
      <section className="kw-affmain"><button className="kw-btn kw-affmenu-btn" onClick={() => setDrawer(true)}><I d={P.filter} size={16} /> Menu</button>{body}</section>
      {drawer ? <><div className="kw-scrim" onClick={() => setDrawer(false)} /><div className="kw-affdrawer kw-pop" role="dialog" aria-label="Menu"><div className="kw-affdrawer-h"><b>Menu</b><button className="kw-x" onClick={() => setDrawer(false)} aria-label="Fechar"><I d={P.close} size={18} /></button></div><div onClick={() => setDrawer(false)}>{menu}</div></div></> : null}
    </div>
  );
}

/** Conversas: empresas das afiliações aparecem para iniciar uma conversa nova. */
function MsgsRoute({ token, chat, go }: { token: string; chat?: string; go(r: Route): void }) {
  const [affs, setAffs] = useState<Affiliation[]>([]);
  useEffect(() => { kw.affiliations(token).then(setAffs).catch(() => undefined); }, [token]);
  const companies = useMemo(() => [...new Map(affs.map((a) => [a.companyCode, { code: a.companyCode, name: a.companyName }])).values()], [affs]);
  return <Messages token={token} company={chat} companies={companies} go={(c) => go({ n: 'msgs', c })} />;
}

function Panel({ d, me, go, products }: { d: Dashboard | null; me: Associate; go(r: Route): void; products: MP[] }) {
  const valid = (d?.sales ?? []).filter((s) => s.state !== 'CANCELLED');
  const since = (days: number) => valid.filter((s) => new Date(s.date).getTime() >= Date.now() - days * 86400000).reduce((a, s) => a + s.amount, 0);
  const today = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return valid.filter((s) => new Date(s.date) >= t).reduce((a, s) => a + s.amount, 0); })();
  const total = (d?.withdrawn ?? 0) + (d?.balance ?? 0) + (d?.pending ?? 0);
  const ring = total > 0 ? (d?.withdrawn ?? 0) / total : 0;
  const top = [...products].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 6);
  return (
    <div className="kw-dash">
      <h1 className="kw-aff-title"><I d={P.grid} size={22} /> Dashboard</h1>
      <div className="kw-aff-banner kw-pop"><div className="kw-aff-banner-txt"><strong>Olá, {me.name.split(' ')[0]}</strong><span>LPS Kwanza · associado</span><em>O teu código: <b>{me.code}</b></em></div></div>
      <section className="kw-dash-card">
        <div className="kw-dash-stats">
          <div><span className="kw-dot g"><I d={P.card} size={16} /></span><small>Saldo disponível</small><b>{kz(d?.balance ?? 0)}</b></div>
          <div><span className="kw-dot b"><I d={P.truck} size={16} /></span><small>Vendas em processo</small><b>{kz(d?.pending ?? 0)}</b></div>
          <div><span className="kw-dot o"><I d={P.clock} size={16} /></span><small>Saldo pendente</small><b>{kz(d?.requested ?? 0)}</b></div>
        </div>
        <button className="kw-btn kw-btn-primary" onClick={() => go({ n: 'withdraw' })}>Solicitar saque</button>
      </section>
      <div className="kw-dash-row">
        <section className="kw-perf2"><h3>Desempenho de vendas</h3><div className="kw-perf2-l"><small>Hoje</small><b>{kz(today)}</b><small>Total últimos 7 dias</small><b>{kz(since(7))}</b><small>Total últimos 30 dias</small><b>{kz(since(30))}</b></div></section>
        <section className="kw-perf2"><h3>Total já retirado</h3><div className="kw-ring"><svg viewBox="0 0 120 120" width="150" height="150"><circle cx="60" cy="60" r="48" fill="none" stroke="#e8ebf3" strokeWidth="14" />{ring > 0 ? <circle cx="60" cy="60" r="48" fill="none" stroke="var(--kw-p)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${ring * 301.6} 301.6`} transform="rotate(-90 60 60)" className="kw-ring-arc" /> : null}</svg><div><b>{kz(d?.withdrawn ?? 0)}</b><small>Total já retirado</small></div></div></section>
      </div>
      {d?.companies.length ? (
        <div className="kw-aff-table"><h3>Saldo por empresa</h3>
          <table className="kw-spec"><thead><tr><th>Empresa</th><th>Em processo</th><th>Disponível</th><th>Em análise</th><th>Retirado</th></tr></thead>
            <tbody>{d.companies.map((c) => <tr key={c.companyId}><td><b>{c.companyName}</b></td><td>{kz(c.pending)}</td><td><b>{kz(c.balance)}</b></td><td>{kz(c.requested)}</td><td>{kz(c.withdrawn)}</td></tr>)}</tbody></table>
        </div>
      ) : null}
      <section className="kw-dash-top"><header><h3><I d={P.eye} size={17} /> Produtos mais vistos</h3></header>
        <ul>{top.map((p) => <li key={p.code}><Pic p={p} className="kw-dash-pic" /><span>{p.name}</span><small><I d={P.eye} size={13} /> {p.views ?? 0}</small><b>{kz(com(p.listing))}</b></li>)}</ul>
      </section>
    </div>
  );
}

function SalesT({ d }: { d: Dashboard | null }) {
  if (!d) return <Loader />;
  return (
    <div className="kw-dash"><h1 className="kw-aff-title"><I d={P.card} size={22} /> Minhas vendas</h1>
      {!d.sales.length ? <div className="kw-empty">Ainda sem vendas</div> : (
        <div className="kw-aff-table"><table className="kw-spec"><thead><tr><th>Empresa</th><th>Encomenda</th><th>Produto</th><th>Data</th><th>Comissão</th><th>Estado</th></tr></thead>
          <tbody>{d.sales.map((s, i) => <tr key={`${s.orderNumber}-${i}`}><td>{s.companyName}</td><td>{s.orderNumber}</td><td>{s.product} × {s.quantity}</td><td>{formatDateTime(s.date)}</td><td><b>{kz(s.amount)}</b></td><td><span className={`kw-pill ${STATE[s.state][1]}`}>{STATE[s.state][0]}</span></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

function Affs({ token, go }: { token: string; go(r: Route): void }) {
  const [rows, setRows] = useState<Affiliation[] | null>(null);
  useEffect(() => { kw.affiliations(token).then(setRows).catch(() => setRows([])); }, [token]);
  if (!rows) return <Loader />;
  return (
    <div className="kw-dash"><h1 className="kw-aff-title"><I d={P.share} size={22} /> Minhas afiliações</h1>
      {!rows.length ? <div className="kw-empty"><p>Ainda não se associou a nenhum produto</p><button className="kw-btn kw-btn-primary" onClick={() => go({ n: 'search', s: { q: '' } })}>Ver mercado</button></div> : (
        <ul className="kw-accounts">{rows.map((a) => (
          <li key={a.id} className="kw-pop"><button className="kw-line-pic" onClick={() => go({ n: 'product', c: a.companyCode, p: a.productCode })} aria-label={a.name}>{a.imageUrl ? <img src={a.imageUrl} alt="" /> : null}</button>
            <div><b>{a.name}</b><small>{a.companyName} · {a.commissionPct}%{a.negotiated ? ' (negociada)' : ''}{a.markupPct ? ` · preço próprio +${a.markupPct}%` : ''}</small><small>Comissão de até {kz(Math.round(a.grossPrice * a.commissionPct) / 100)}</small></div>
            <span className={`kw-pill ${STATE[a.status][1]}`}>{STATE[a.status][0]}</span></li>
        ))}</ul>
      )}
    </div>
  );
}

function Withdraw({ token, d, onDone, go }: { token: string; d: Dashboard | null; onDone(): void; go(r: Route): void }) {
  const [accs, setAccs] = useState<PayoutAccount[] | null>(null);
  const [company, setCompany] = useState(''); const [amount, setAmount] = useState(''); const [acc, setAcc] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { kw.accounts(token).then((r) => { setAccs(r); if (r[0]) setAcc(r[0].id); }).catch(() => setAccs([])); }, [token]);
  useEffect(() => { const c = d?.companies.find((x) => x.balance > 0); if (c && !company) setCompany(c.companyCode); }, [d, company]);
  if (!d) return <Loader />;
  const cur = d.companies.find((c) => c.companyCode === company);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); const a = Number(amount.replace(',', '.'));
    if (!cur) { setErr('Escolha a empresa.'); return; } if (!(a > 0) || a > cur.balance) { setErr('Valor inválido para o saldo desta empresa.'); return; } if (!acc) { setErr('Escolha a conta.'); return; }
    setBusy(true); try { await kw.withdraw(token, company, a, acc); setAmount(''); onDone(); } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível.'); } finally { setBusy(false); }
  };
  return (
    <div className="kw-dash">
      <div className="kw-counters">
        <div className="kw-bal-c main"><b>{kz(d.balance)}</b><span>Saldo disponível</span></div><div className="kw-bal-c"><b>{kz(d.pending)}</b><span>Vendas em processo</span></div>
        <div className="kw-bal-c"><b>{kz(d.requested)}</b><span>Saldo pendente</span></div><div className="kw-bal-c"><b>{kz(d.withdrawn)}</b><span>Total já retirado</span></div>
      </div>
      <form className="kw-profile" onSubmit={(e) => void submit(e)}>
        <h3>Fazer saque</h3>
        <label className="kw-f"><span>Empresa que paga</span><select value={company} onChange={(e) => setCompany(e.target.value)}><option value="">Escolha</option>{d.companies.map((c) => <option key={c.companyCode} value={c.companyCode}>{c.companyName} — {kz(c.balance)}</option>)}</select></label>
        <label className="kw-f"><span>Valor (Kz)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={cur ? String(cur.balance) : ''} /></label>
        <div className="kw-f"><span>Conta para receber</span>{accs && accs.length ? <div className="kw-acc-pick">{accs.map((a) => <label key={a.id} className={`kw-acc-opt${acc === a.id ? ' on' : ''}`}><input type="radio" name="acc" checked={acc === a.id} onChange={() => setAcc(a.id)} /><span><b>{a.method}{a.bank ? ` · ${a.bank}` : ''}</b><small>{a.details} · {a.holder}</small></span></label>)}</div> : <button type="button" className="kw-btn kw-btn-outline" onClick={() => go({ n: 'accounts' })}>+ Registar conta bancária</button>}</div>
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-green" disabled={busy || !accs?.length || !d.balance}>FAZER SAQUES</button>
      </form>
      <div className="kw-aff-table"><h3>Histórico de transações</h3>
        <table className="kw-spec"><thead><tr><th>Data</th><th>Empresa</th><th>Descrição</th><th>Valor</th><th>Estado</th><th>Comprovativo</th></tr></thead>
          <tbody>{d.withdrawals.length ? d.withdrawals.map((w) => <tr key={w.id}><td>{formatDateTime(w.date)}</td><td>{w.companyName}</td><td>{w.method}{w.note ? <div className="kw-muted">{w.note}</div> : null}</td><td><b>{kz(w.amount)}</b></td><td><span className={`kw-pill ${STATE[w.status]?.[1] ?? ''}`}>{STATE[w.status]?.[0] ?? w.status}</span></td><td>{w.proofUrl ? <a className="kw-link" href={w.proofUrl} target="_blank" rel="noopener noreferrer" download={`comprovativo-${w.id}`}>Ver</a> : '—'}</td></tr>) : <tr><td colSpan={6} className="kw-muted" style={{ textAlign: 'center' }}>Sem transações</td></tr>}</tbody></table>
      </div>
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
    <div className="kw-dash"><h1 className="kw-aff-title"><I d={P.shield} size={22} /> Contas bancárias <small className="kw-muted">{n}/3</small></h1>
      <div className="kw-warn">Os dados bancários têm de estar em seu nome.</div>
      {n < 3 ? <form className="kw-profile" onSubmit={(e) => void add(e)}><h3>Nova conta bancária</h3>
        <label className="kw-f"><span>Receber por</span><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option>Transferência bancária</option><option>Multicaixa Express</option></select></label>
        {f.method !== 'Multicaixa Express' ? <label className="kw-f"><span>Banco</span><select value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })}><option value="">Escolha o banco</option>{BANKS.map((b) => <option key={b}>{b}</option>)}</select></label> : null}
        <label className="kw-f"><span>Titular</span><input value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} /></label>
        <label className="kw-f"><span>{f.method === 'Multicaixa Express' ? 'Número de telefone' : 'IBAN'}</span><input value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></label>
        {err ? <div className="kw-err">{err}</div> : null}<button className="kw-btn kw-btn-primary">Registar conta</button></form> : null}
      {rows === null ? <Loader /> : <ul className="kw-accounts">{rows.map((a) => <li key={a.id}><span className="kw-dot b"><I d={a.method === 'Multicaixa Express' ? P.phone : P.card} size={16} /></span><div><b>{a.method}{a.bank ? ` · ${a.bank}` : ''}</b><small>{a.details}</small><small>{a.holder}</small></div><button className="kw-x" aria-label="Eliminar conta" onClick={() => { if (window.confirm('Eliminar esta conta?')) void kw.removeAccount(token, a.id).then(load); }}><I d={P.trash} size={17} /></button></li>)}</ul>}
    </div>
  );
}

function Profile({ token, me, flash }: { token: string; me: Associate; flash(t: string): void }) {
  const [f, setF] = useState({ name: me.name, email: me.email ?? '', taxId: me.taxId ?? '', province: me.province ?? '', municipality: me.municipality ?? '', address: me.address ?? '', bio: me.bio ?? '' });
  const [photo, setPhoto] = useState<string | null>(me.photoUrl);
  const [pw, setPw] = useState({ current: '', next: '' }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const pick = (file?: File) => { if (!file) return; if (file.size > 1_000_000) { setErr('Imagem demasiado grande (máx. 1 MB).'); return; } void readFileProgress(file).then(setPhoto); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const a = await kw.saveProfile(token, { ...f, photoUrl: photo }); const s = session.get(); if (s) session.set({ ...s, associate: a }); flash('Perfil guardado'); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível guardar.'); } finally { setBusy(false); }
  };
  const changePw = async (e: React.FormEvent) => { e.preventDefault(); setErr(null); try { await kw.password(token, pw.current, pw.next); setPw({ current: '', next: '' }); flash('Senha alterada'); } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível.'); } };
  return (
    <div className="kw-dash"><h1 className="kw-aff-title"><I d={P.user} size={22} /> Perfil</h1>
      <form className="kw-profile" onSubmit={(e) => void save(e)}>
        <div className="kw-ph-row">
          <span className="kw-ph">{photo ? <img src={photo} alt="" /> : <b>{me.name.slice(0, 1).toUpperCase()}</b>}</span>
          <div><b>{me.name}</b><small className="kw-muted">Código {me.code} · {me.phone}</small>
            <label className="kw-btn kw-btn-outline" style={{ cursor: 'pointer' }}>{photo ? 'Trocar foto' : 'Carregar foto'}<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
            {photo ? <button type="button" className="kw-link" onClick={() => setPhoto(null)}>Remover foto</button> : null}
          </div>
        </div>
        <label className="kw-f"><span>Nome completo</span><input value={f.name} onChange={set('name')} /></label>
        <label className="kw-f"><span>Email</span><input type="email" value={f.email} onChange={set('email')} /></label>
        <label className="kw-f"><span>NIF / BI</span><input value={f.taxId} onChange={set('taxId')} /></label>
        <label className="kw-f"><span>Província</span><input value={f.province} onChange={set('province')} /></label>
        <label className="kw-f"><span>Município</span><input value={f.municipality} onChange={set('municipality')} /></label>
        <label className="kw-f"><span>Endereço</span><input value={f.address} onChange={set('address')} /></label>
        <label className="kw-f kw-f-wide"><span>Sobre mim</span><textarea value={f.bio} onChange={set('bio')} rows={3} maxLength={400} /></label>
        {err ? <div className="kw-err">{err}</div> : null}
        <button className="kw-btn kw-btn-primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar perfil'}</button>
      </form>
      <form className="kw-profile" onSubmit={(e) => void changePw(e)}><h3>Mudar a senha</h3>
        <label className="kw-f"><span>Senha atual</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
        <label className="kw-f"><span>Nova senha</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
        <button className="kw-btn kw-btn-primary">Mudar senha</button>
      </form>
    </div>
  );
}
