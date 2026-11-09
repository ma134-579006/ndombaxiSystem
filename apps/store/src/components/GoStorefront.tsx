import React, { useEffect, useMemo, useState } from 'react';
import '../go.css';
import type { CatalogProduct } from '../api/types';
import { formatKz } from '../format';
import { useStore } from '../state/StoreContext';
import { cartCount, cartTotal } from '../store/cart';
import { IconCart, IconChevronLeft, IconChevronRight, IconImage, IconMinus, IconPlus, IconTrash, IconBox } from './Icons';

/**
 * Montra de RETALHO no modelo das lojas online de faturação (referência de
 * funcionamento: Vendus GO), com a identidade do LPS Vendas:
 *   • capa com o logótipo redondo da loja, nome e frase ao centro;
 *   • à esquerda, SEMPRE à vista: o carrinho (contador, linhas, total, Limpar,
 *     Finalizar) e o menu de categorias;
 *   • à direita, grelha de produtos com nome, imagem, preço, quantidade e
 *     ADICIONAR — "Indisponível" quando não há stock;
 *   • paginação de 20 por página (lojas com milhares de artigos abrem logo).
 * No telemóvel o carrinho passa a barra fixa no fundo e as categorias a tira.
 */
const PER_PAGE = 20;

export function GoStorefront(props: {
  storeName: string;
  tagline: string;
  products: CatalogProduct[];
  categories: string[];
  search: string;
  onOpen(p: CatalogProduct): void;
  onAdd(p: CatalogProduct, qty: number): void;
  onCheckout(): void;
  /** Produto aberto (página de produto no mesmo modelo) — ou nada (lista). */
  product?: CatalogProduct | null;
  onBack?(): void;
  /** Conteúdo central alternativo (ex.: Finalizar encomenda). */
  children?: React.ReactNode;
  /** Título na capa (por omissão o nome da loja). */
  title?: string;
}) {
  const { data, cart, setQty, removeFromCart, clearCart } = useStore();
  const s = data?.settings;
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(1);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [bump, setBump] = useState(0);

  const list = useMemo(() => {
    const q = props.search.trim().toLowerCase();
    const out = props.products.filter((p) => (!cat || p.category === cat)
      && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)));
    // Disponíveis primeiro (ordem do catálogo mantida dentro de cada grupo): numa
    // loja com muitos artigos sem stock, as primeiras páginas eram só "Indisponível".
    const ok = (p: CatalogProduct) => p.inStock || !!p.canProduce;
    return [...out.filter(ok), ...out.filter((p) => !ok(p))];
  }, [props.products, props.search, cat]);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const first = React.useRef(true);
  useEffect(() => {
    setPage(1);
    if (first.current) { first.current = false; return; }
    document.getElementById('go-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [cat, props.search]);
  const view = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const go = (n: number) => { setPage(Math.min(pages, Math.max(1, n))); document.getElementById('go-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const count = cartCount(cart);
  const total = cartTotal(cart);
  const add = (p: CatalogProduct) => {
    props.onAdd(p, Math.max(1, qtys[p.code] ?? 1));
    setQtys((m) => ({ ...m, [p.code]: 1 }));
    setBump((b) => b + 1);
  };
  const canOrder = (p: CatalogProduct) => p.inStock || !!p.canProduce;

  // Números de página à volta da atual (como as lojas de faturação: 1 … 10, Seguinte).
  const nums = useMemo(() => {
    const out: number[] = [];
    const from = Math.max(1, Math.min(page - 4, pages - 9));
    for (let i = from; i <= Math.min(pages, from + 9); i++) out.push(i);
    return out;
  }, [page, pages]);

  const cartBox = (
    <div className="go-cart">
      <div className="go-cart-h">
        <span className="go-cart-ic" key={bump}><IconCart size={22} />{count ? <i>{count}</i> : null}</span>
        <span className="go-cart-t">Carrinho</span>
        <strong>{formatKz(total)}</strong>
      </div>
      {cart.length === 0 ? (
        <div className="go-cart-empty"><IconBox size={26} /><span>Carrinho vazio</span></div>
      ) : (
        <ul className="go-cart-lines">
          {cart.map((l) => (
            <li key={l.product.code}>
              <span className="nm" title={l.product.name}>{l.product.name}</span>
              <span className="go-step sm">
                <button aria-label="Menos" onClick={() => setQty(l.product.code, l.quantity - 1)}><IconMinus size={13} /></button>
                <b>{l.quantity}</b>
                <button aria-label="Mais" onClick={() => setQty(l.product.code, l.quantity + 1)}><IconPlus size={13} /></button>
              </span>
              <span className="pr">{formatKz(l.product.grossPrice * l.quantity)}</span>
              <button className="rm" aria-label={`Remover ${l.product.name}`} onClick={() => removeFromCart(l.product.code)}><IconTrash size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="go-cart-act">
        <button className="go-btn ghost" disabled={!cart.length} onClick={clearCart}>Limpar</button>
        <button className="go-btn" disabled={!cart.length} onClick={props.onCheckout}>Finalizar</button>
      </div>
    </div>
  );

  return (
    <div className="go">
      <section className="go-cover"><div className="go-cover-bg" aria-hidden /></section>
      <div className="go-logo-wrap">
        <div className="go-logo">
          {s?.logo_url ? <img src={s.logo_url} alt={props.storeName} width={120} height={120} /> : <span>{props.storeName.slice(0, 2).toUpperCase()}</span>}
        </div>
      </div>
      <div className="go-title">
        <h1>{props.title ?? (props.product ? props.product.name : props.storeName)}</h1>
        {props.tagline ? <p>{props.tagline}</p> : null}
      </div>

      <div className="wrap go-main">
        {props.children ? null : <aside className="go-side">
          {cartBox}
          {props.categories.length > 0 ? (
            <nav className="go-menu" aria-label="Categorias">
              <div className="go-menu-h">Menu</div>
              <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>Todos os produtos</button>
              {props.categories.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
            </nav>
          ) : null}
        </aside>}

        {props.product ? (
          <section className="go-content go-pdp" id="go-grid">
            <div className="go-pdp-img">
              {props.product.imageUrl ? <img src={props.product.imageUrl} alt={props.product.name} width={420} height={420} /> : <IconImage size={110} />}
            </div>
            <div className="go-pdp-info">
              <h2>{props.product.name}</h2>
              <div className="go-price lg">
                {canOrder(props.product)
                  ? <>{props.product.promo && props.product.listPrice && props.product.listPrice > props.product.grossPrice ? <s>{formatKz(props.product.listPrice)}</s> : null}<b>{formatKz(props.product.grossPrice)}</b></>
                  : <b className="na">Indisponível</b>}
              </div>
              <div className="go-buy start">
                <button className="go-btn" disabled={!canOrder(props.product)} onClick={() => add(props.product!)}>Adicionar</button>
                <input className="go-qty" type="number" min={1} inputMode="numeric" aria-label="Quantidade"
                  value={qtys[props.product.code] ?? 1} disabled={!canOrder(props.product)}
                  onChange={(e) => setQtys((m) => ({ ...m, [props.product!.code]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))} />
              </div>
              {props.product.description ? <p className="go-pdp-desc">{props.product.description}</p> : null}
              {props.onBack ? <button className="go-link" onClick={props.onBack}><IconChevronLeft size={16} /> Voltar aos produtos</button> : null}
            </div>
          </section>
        ) : props.children ? (
          <section className="go-content" id="go-grid">{props.children}</section>
        ) : (
        <section className="go-content" id="go-grid">
          {props.categories.length > 0 ? (
            <div className="go-chips" role="tablist" aria-label="Categorias">
              <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>Todos</button>
              {props.categories.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          ) : null}
          <div className="go-count">{list.length} produto{list.length === 1 ? '' : 's'}{cat ? ` em ${cat}` : ''}</div>

          {view.length === 0 ? (
            <div className="empty"><IconImage size={46} /><p>Nenhum produto encontrado.</p></div>
          ) : (
            <div className="go-grid">
              {view.map((p, i) => {
                const promo = p.promo && p.listPrice && p.listPrice > p.grossPrice;
                return (
                  <article className="go-card" key={p.code} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
                    <button className="go-name" title={p.name} onClick={() => props.onOpen(p)}>{p.name}</button>
                    <button className="go-img" onClick={() => props.onOpen(p)} aria-label={`Ver ${p.name}`}>
                      {p.imageUrl ? <img src={p.imageUrl} alt={p.name} loading="lazy" width={220} height={160} /> : <IconImage size={64} />}
                      {promo ? <span className="go-off">-{p.promo!.percent}%</span> : null}
                    </button>
                    <div className="go-price">
                      {canOrder(p) ? <>{promo ? <s>{formatKz(p.listPrice!)}</s> : null}<b>{formatKz(p.grossPrice)}</b></> : <b className="na">Indisponível</b>}
                    </div>
                    <div className="go-buy">
                      <button className="go-btn" disabled={!canOrder(p)} onClick={() => add(p)}>Adicionar</button>
                      <input className="go-qty" type="number" min={1} inputMode="numeric" aria-label={`Quantidade de ${p.name}`}
                        value={qtys[p.code] ?? 1} disabled={!canOrder(p)}
                        onChange={(e) => setQtys((m) => ({ ...m, [p.code]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {pages > 1 ? (
            <nav className="go-pager" aria-label="Páginas">
              <button disabled={page === 1} onClick={() => go(page - 1)} aria-label="Anterior"><IconChevronLeft size={16} /></button>
              {nums.map((n) => <button key={n} className={n === page ? 'on' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => go(n)}>{n}</button>)}
              <button disabled={page === pages} onClick={() => go(page + 1)}>Seguinte <IconChevronRight size={16} /></button>
              <span className="go-pager-of">Página {page} de {pages}</span>
            </nav>
          ) : null}
        </section>
        )}
      </div>

      {/* Telemóvel: o carrinho fica sempre à mão, numa barra fixa no fundo. */}
      <div className="go-mbar" hidden={!count}>
        <span className="go-cart-ic" key={`m${bump}`}><IconCart size={20} /><i>{count}</i></span>
        <strong>{formatKz(total)}</strong>
        <button className="go-btn" onClick={props.onCheckout}>Finalizar</button>
      </div>
    </div>
  );
}
