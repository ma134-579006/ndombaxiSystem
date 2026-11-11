import React, { useMemo, useRef } from 'react';
import type { CatalogProduct, PaymentMethod } from '../api/types';
import { BRAND, Card, CardSkeleton, Carousel, I, P, Pic, Shelf, type Slide, kz, pct, useCountdown, useInfinite, useReveal } from './parts';

export interface Banner { id: string; title: string; subtitle: string | null; imageUrl: string | null; linkUrl: string | null; buttonLabel: string | null }

export interface HomeProps {
  products: CatalogProduct[] | null;
  banners: Banner[];
  methods: PaymentMethod[];
  card(p: CatalogProduct, hot?: boolean): React.ReactNode;
  openSearch(q: string, opts?: { cat?: string; promo?: boolean }): void;
  openProduct(code: string): void;
  openLink(link: string | null): void;
  tagline?: string | null;
  storeName?: string;
}

/** Categorias com contagem e uma imagem representativa (1.º produto com foto). */
export function useCategories(products: CatalogProduct[] | null) {
  return useMemo(() => {
    const m = new Map<string, { name: string; count: number; img: CatalogProduct | null }>();
    for (const p of products ?? []) {
      if (!p.category) continue;
      const c = m.get(p.category) ?? { name: p.category, count: 0, img: null };
      c.count += 1;
      if (!c.img && p.imageUrl) c.img = p;
      if (!c.img) c.img = p;
      m.set(p.category, c);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [products]);
}

export function Home({ products, banners, methods, card, openSearch, openProduct, openLink, tagline, storeName }: HomeProps) {
  const list = products ?? [];
  const cats = useCategories(products);
  const flash = useMemo(() => list.filter((p) => pct(p) > 0).sort((a, b) => pct(b) - pct(a)).slice(0, 12), [list]);
  const ends = flash.map((p) => p.promo?.endsAt).filter((e): e is string => !!e).sort()[0] ?? null;
  const left = useCountdown(ends);
  const top = useMemo(() => [...list].filter((p) => (p.sold ?? 0) > 0).sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0)).slice(0, 12), [list]);
  const discover = useMemo(() => list.filter((p) => !top.includes(p)), [list, top]);
  const [shown, sentinel] = useInfinite(discover.length, 20, discover.length);
  const catTrack = useRef<HTMLDivElement | null>(null);
  useReveal(`${list.length}-${shown}`);

  // Anúncios do painel; sem anúncios, a loja gera-os a partir do próprio catálogo.
  const slides: Slide[] = useMemo(() => {
    const own = banners.map((b, k): Slide => ({ id: b.id, title: b.title, subtitle: b.subtitle, image: b.imageUrl, cta: b.buttonLabel, tone: k, onClick: () => openLink(b.linkUrl) }));
    if (own.length >= 3) return own;
    const auto: Slide[] = [];
    if (flash.length) auto.push({ id: 'a-flash', title: 'Oferta relâmpago', subtitle: `Até ${pct(flash[0])}% de desconto`, image: flash.find((p) => p.imageUrl)?.imageUrl, cta: 'Ver ofertas', tone: 0, onClick: () => openSearch('', { promo: true }) });
    if (top[0]) auto.push({ id: 'a-top', title: top[0].name, subtitle: kz(top[0].grossPrice), image: top[0].imageUrl, cta: 'Comprar', tone: 1, onClick: () => openProduct(top[0].code) });
    for (const c of cats.slice(0, 3)) auto.push({ id: `a-c-${c.name}`, title: c.name, subtitle: `${c.count} produtos`, image: c.img?.imageUrl, cta: 'Ver categoria', tone: 2 + auto.length, onClick: () => openSearch('', { cat: c.name }) });
    if (!auto.length && list[0]) auto.push({ id: 'a-brand', title: BRAND, subtitle: `${list.length} produtos`, image: list.find((p) => p.imageUrl)?.imageUrl, cta: 'Ver produtos', tone: 0, onClick: () => openSearch('') });
    return [...own, ...auto];
  }, [banners, flash, top, cats, list, openLink, openSearch, openProduct]);

  const main = slides.slice(0, Math.max(1, slides.length - 2));
  const side = slides.length > 2 ? slides.slice(-2) : [];
  const wide = banners[3] ?? null;

  if (products === null) {
    return (
      <div className="kw-container">
        <div className="kw-hero kw-skel-hero" aria-busy="true" />
        <div className="kw-grid6">{Array.from({ length: 12 }, (_, k) => <CardSkeleton key={k} />)}</div>
      </div>
    );
  }
  if (!list.length) return <div className="kw-container kw-empty">Sem produtos</div>;

  return (
    <>
      {/* Anúncios + categorias em círculos */}
      <div className="kw-herowrap">
        <section className="kw-container kw-hero">
          <div className={`kw-hero-grid${side.length ? '' : ' one'}`}>
            <Carousel slides={main} className="kw-hero-main" />
            {side.length ? (
              <div className="kw-hero-side">
                {side.map((s) => (
                  <button key={s.id} className={`kw-slide kw-side tone-${s.tone % 4}`} onClick={s.onClick}>
                    {s.image ? <img src={s.image} alt="" loading="lazy" /> : null}
                    <span className="kw-slide-txt"><strong>{s.title}</strong>{s.subtitle ? <small>{s.subtitle}</small> : null}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {cats.length ? (
            <div className="kw-circles">
              <button className="kw-arrow l" onClick={() => catTrack.current?.scrollBy({ left: -400, behavior: 'smooth' })} aria-label="Categorias anteriores"><I d={P.back} size={16} /></button>
              <div className="kw-circles-track" ref={catTrack}>
                {cats.map((c) => (
                  <button key={c.name} className="kw-circle" onClick={() => openSearch('', { cat: c.name })}>
                    <span className="kw-circle-img">{c.img ? <Pic p={c.img} /> : null}</span>
                    <span className="kw-circle-lbl">{c.name}</span>
                  </button>
                ))}
              </div>
              <button className="kw-arrow r" onClick={() => catTrack.current?.scrollBy({ left: 400, behavior: 'smooth' })} aria-label="Mais categorias"><I d={P.next} size={16} /></button>
            </div>
          ) : null}
          {tagline ? <p className="kw-tagline">“{tagline}”</p> : null}
        </section>
      </div>

      <div className="kw-container kw-stack">
        {/* Oferta relâmpago */}
        {flash.length ? (
          <Shelf className="kw-flash" title="OFERTA RELÂMPAGO" items={flash} render={(p) => card(p)}
            head={(
              <header className="kw-flash-head">
                <h2><I d={P.bolt} size={20} /> OFERTA RELÂMPAGO</h2>
                {left ? <span className="kw-timer">Termina em <b>{left[0]}</b>:<b>{left[1]}</b>:<b>{left[2]}</b></span> : null}
                <button className="kw-flash-all" onClick={() => openSearch('', { promo: true })}>Ver tudo <I d={P.next} size={14} /></button>
              </header>
            )} />
        ) : null}

        {/* Banner largo (4.º anúncio do painel) */}
        {wide ? (
          <button className="kw-wide kw-reveal" onClick={() => openLink(wide.linkUrl)}>
            {wide.imageUrl ? <img src={wide.imageUrl} alt={wide.title} loading="lazy" /> : <span className="kw-slide-txt"><strong>{wide.title}</strong>{wide.subtitle ? <small>{wide.subtitle}</small> : null}</span>}
          </button>
        ) : null}

        {/* Grelha de categorias */}
        {cats.length ? (
          <section className="kw-sec kw-reveal">
            <header className="kw-sec-head"><h2>CATEGORIAS</h2></header>
            <div className="kw-catgrid">
              {cats.map((c) => (
                <button key={c.name} className="kw-cat" onClick={() => openSearch('', { cat: c.name })}>
                  <span className="kw-cat-img">{c.img ? <Pic p={c.img} /> : null}</span>
                  <span className="kw-cat-lbl">{c.name}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Destaque */}
        <Shelf title="DESTAQUE" items={top} render={(p) => card(p, true)}
          action={<button className="kw-link" onClick={() => openSearch('', {})}>Ver Tudo</button>} />

        {/* Descobertas do dia (carregamento infinito) */}
        <section className="kw-disc">
          <header className="kw-disc-head"><h2>DESCOBERTAS DO DIA</h2></header>
          <div className="kw-grid6">{discover.slice(0, shown).map((p) => <div key={p.code} className="kw-reveal">{card(p)}</div>)}</div>
          {shown < discover.length ? <div ref={sentinel} className="kw-loader" aria-busy="true"><i /><i /><i /></div> : null}
        </section>

        {/* Comprar na LPS Kwanza + perguntas frequentes (só o que o sistema faz de facto) */}
        <section className="kw-info kw-reveal">
          <h2>Comprar na {BRAND}</h2>
          <p>A {BRAND} é a loja online reservada aos associados{storeName ? ` da ${storeName}` : ''}: os mesmos produtos, preços e promoções da loja, com acesso aprovado pela empresa. Pagamento por {methods.length ? methods.map((m) => m.label).join(', ') : 'Numerário'}. Cada encomenda pode ser acompanhada em tempo real e a loja responde pelo chat.</p>
          <p>Também pode ganhar como associado: escolha produtos com comissão no Mercado de Associados, partilhe a sua ligação e receba a comissão de cada venda entregue, com pedido de saque do saldo disponível.</p>
          <h3>Perguntas frequentes</h3>
          <div className="kw-faq">
            <details><summary>Como comprar na {BRAND}?</summary><p>Procure o produto pela pesquisa ou pelas categorias, abra a página do produto, adicione ao carrinho e conclua a compra escolhendo a forma de pagamento. É preciso ser associado aprovado.</p></details>
            <details><summary>Que meios de pagamento são aceites?</summary><p>{methods.length ? methods.map((m) => m.label).join(', ') : 'Numerário'}. Os preços estão sempre em kwanzas (Kz).</p></details>
            <details><summary>Como acompanho a minha encomenda?</summary><p>Em Conta → Minhas compras abre cada encomenda com o estado atualizado e a conversa com a loja.</p></details>
            <details><summary>Como funciona o programa de associados?</summary><p>No Mercado de Associados vê os produtos com comissão, copia a sua ligação e partilha. A venda feita pela ligação (último clique) gera comissão: fica pendente até a encomenda ser entregue e depois passa para o saldo disponível.</p></details>
            <details><summary>Como peço o saque?</summary><p>Em Mercado de Associados → Saldo e saques indique o valor e onde quer receber (Multicaixa Express ou transferência). A loja confirma o pagamento.</p></details>
          </div>
        </section>

        {/* Selos com o que a loja realmente oferece */}
        <section className="kw-perks kw-reveal">
          <div><I d={P.shield} size={28} /><strong>Pagamento seguro</strong><span>{methods.length ? methods.map((m) => m.label).join(' · ') : 'Numerário'}</span></div>
          <div><I d={P.truck} size={28} /><strong>Acompanhe a encomenda</strong><span>Estado em tempo real</span></div>
          <div><I d={P.chat} size={28} /><strong>Fale com a loja</strong><span>Chat direto</span></div>
          <div><I d={P.check} size={28} /><strong>Só associados</strong><span>Acesso aprovado pela loja</span></div>
        </section>
      </div>
    </>
  );
}
