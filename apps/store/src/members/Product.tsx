import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { CatalogProduct, PaymentMethod, ProductReviews } from '../api/types';
import { I, P, Pic, Shelf, canBuy, kz, pct, pushRecent, readRecent, useInfinite, useReveal } from './parts';

export function Product({ code: storeCode, token, products, productCode, storeName, methods, cod, contact, onAdd, onBuy, card }: {
  code: string; token: string; products: CatalogProduct[]; productCode: string; storeName: string; methods: PaymentMethod[]; cod: boolean;
  contact: { email: string | null; phone: string | null; address: string | null };
  onAdd(p: CatalogProduct, qty: number): void; onBuy(p: CatalogProduct, qty: number): void; card(p: CatalogProduct): React.ReactNode;
}) {
  const p = products.find((x) => x.code === productCode);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [more, setMore] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const [rev, setRev] = useState<ProductReviews | null>(null);
  useEffect(() => { setImg(0); setQty(1); setMore(false); window.scrollTo({ top: 0 }); if (p) pushRecent(storeCode, p.code); }, [productCode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRev(null); api.reviews(storeCode, productCode, token).then(setRev).catch(() => setRev(null)); }, [storeCode, productCode, token]);
  useEffect(() => {
    const k = `ndombaxi.kw.viewed.${storeCode}.${productCode}`;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch { /* sem armazenamento: conta na mesma */ }
    void api.productView(storeCode, productCode).catch(() => undefined);
  }, [storeCode, productCode]);

  const similar = useMemo(() => (p ? products.filter((x) => x.code !== p.code && x.category && x.category === p.category).slice(0, 12) : []), [products, p]);
  const recent = useMemo(() => readRecent(storeCode).filter((c) => c !== productCode).map((c) => products.find((x) => x.code === c)).filter((x): x is CatalogProduct => !!x).slice(0, 12), [products, productCode, storeCode]);
  const love = useMemo(() => (p ? products.filter((x) => x.code !== p.code && !similar.includes(x)) : []), [products, p, similar]);
  const [shown, sentinel] = useInfinite(love.length, 12, productCode);
  useReveal(`${productCode}-${shown}`);

  if (!p) return <div className="kw-container kw-empty">Produto indisponível</div>;
  const pics = [p.imageUrl, ...(p.gallery ?? [])].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  const d = pct(p);
  const ok = canBuy(p);
  const maxQ = p.madeToOrder || p.stockQty == null ? 99 : Math.max(1, Math.floor(p.stockQty));
  const long = (p.description ?? '').length > 420;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const buyBox = (
    <>
      <div className="kw-side-price"><b>{kz(p.grossPrice)}</b>{d > 0 && p.listPrice ? <s>{kz(p.listPrice)}</s> : null}</div>
      <div className="kw-side-row">Vendido por: <b>{storeName}</b></div>
      <ul className="kw-side-list">
        <li><I d={P.box} size={16} /><span><b>{ok ? 'Disponível' : 'Esgotado'}</b>{ok && p.stockQty != null && !p.madeToOrder ? <small>{Math.floor(p.stockQty)} em stock</small> : null}</span></li>
        <li><I d={P.truck} size={16} /><span><b>Acompanhamento</b><small>Estado da encomenda em tempo real</small></span></li>
        {cod ? <li><I d={P.card} size={16} /><span><b>Pagamento na entrega</b></span></li> : null}
      </ul>
      <div className="kw-qty-row"><span>Quantidade:</span>
        <div className="kw-qty" role="group" aria-label="Quantidade">
          <button onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="Menos">−</button>
          <input value={qty} inputMode="numeric" aria-label="Quantidade" onChange={(e) => setQty(Math.max(1, Math.min(maxQ, Number(e.target.value.replace(/\D/g, '')) || 1)))} />
          <button onClick={() => setQty((n) => Math.min(maxQ, n + 1))} aria-label="Mais">+</button>
        </div>
      </div>
      <button className="kw-btn kw-btn-primary kw-block" disabled={!ok} onClick={() => onBuy(p, qty)}>Comprar</button>
      <button className="kw-btn kw-btn-outline kw-block" disabled={!ok} onClick={() => onAdd(p, qty)}>Adicionar ao carrinho</button>
    </>
  );

  return (
    <div className="kw-container kw-pdp">
      <div className="kw-pdp-grid">
        <div className="kw-pdp-main">
          <div className="kw-pdp-top">
            <div className="kw-gal">
              {pics.length > 1 ? (
                <div className="kw-thumbs">
                  {pics.map((u, i) => <button key={u} className={i === img ? 'on' : ''} onMouseEnter={() => setImg(i)} onClick={() => setImg(i)} aria-label={`Imagem ${i + 1}`}><img src={u} alt="" loading="lazy" /></button>)}
                </div>
              ) : null}
              <div className="kw-gal-main" onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }); }} onMouseLeave={() => setZoom(null)}>
                {pics.length ? (
                  <>
                    <img src={pics[img] ?? pics[0]} alt={p.name} style={zoom ? { transformOrigin: `${zoom.x}% ${zoom.y}%`, transform: 'scale(1.8)' } : undefined} />
                    {pics.length > 1 ? (
                      <>
                        <button className="kw-gal-nav l" onClick={() => setImg((i) => (i - 1 + pics.length) % pics.length)} aria-label="Imagem anterior"><I d={P.back} size={18} /></button>
                        <button className="kw-gal-nav r" onClick={() => setImg((i) => (i + 1) % pics.length)} aria-label="Próxima imagem"><I d={P.next} size={18} /></button>
                      </>
                    ) : null}
                  </>
                ) : <Pic p={p} />}
              </div>
            </div>
            <div className="kw-pdp-info">
              <h1>{p.name}</h1>
              {p.rating ? <div className="kw-stars" aria-label={`${p.rating.toFixed(1)} de 5`}>{'★'.repeat(Math.round(p.rating))}{'☆'.repeat(5 - Math.round(p.rating))}<small>{p.rating.toFixed(1)} ({p.reviews ?? 0})</small></div> : null}
              {(p.sold ?? 0) > 0 || (p.views ?? 0) > 0 ? (
                <div className="kw-pdp-meta">
                  {(p.sold ?? 0) > 0 ? <span className="kw-pill-soft"><I d={P.bag} size={14} /> {p.sold} vendidos</span> : null}
                  {(p.views ?? 0) > 0 ? <span className="kw-pill-soft"><I d={P.eye} size={14} /> {p.views} visualizações</span> : null}
                </div>
              ) : null}
              <div className={`kw-pricebox${d > 0 ? ' promo' : ''}`}>
                {d > 0 && p.promo ? <span className="kw-pricebox-tag">{p.promo.name}</span> : null}
                <div><b>{kz(p.grossPrice)}</b>{d > 0 && p.listPrice ? <span className="kw-save">Poupe {kz(p.listPrice - p.grossPrice)}</span> : null}</div>
                {d > 0 && p.listPrice ? <s>{kz(p.listPrice)}</s> : null}
              </div>
              {contact.address ? <span className="kw-pill-loc"><I d={P.pin} size={14} /> Vendido a partir de: {contact.address}</span> : null}
              {methods.length ? (
                <div className="kw-pay"><h3>Formas de pagamento</h3><div>{methods.map((m) => <span key={m.id} className="kw-pay-chip">{m.label}</span>)}</div></div>
              ) : null}
              <div className="kw-pdp-buy-mobile">{buyBox}</div>
            </div>
          </div>

          <nav className="kw-secnav" aria-label="Secções do produto">
            <button onClick={() => jump('pd-det')}><I d={P.doc} size={15} /> Detalhes</button>
            <button onClick={() => jump('pd-info')}><I d={P.info} size={15} /> Informações gerais</button>
            <button onClick={() => jump('pd-rev')}><I d={P.star} size={15} /> Avaliações</button>
            <button onClick={() => jump('pd-store')}><I d={P.bag} size={15} /> Loja</button>
            <button onClick={() => jump('pd-love')}><I d={P.heart} size={15} /> Você também vai gostar</button>
          </nav>

          <section id="pd-det" className="kw-block-sec kw-reveal">
            <h2>Detalhes</h2>
            {p.description ? (
              <>
                <p className={`kw-desc${long && !more ? ' clip' : ''}`}>{p.description}</p>
                {long ? <button className="kw-link" onClick={() => setMore((v) => !v)}>{more ? 'Ver menos' : 'Ver mais'}</button> : null}
              </>
            ) : <p className="kw-muted">—</p>}
          </section>

          <section id="pd-info" className="kw-block-sec kw-reveal">
            <h2>Informações gerais</h2>
            <table className="kw-spec"><tbody>
              <tr><th>Código</th><td>{p.code}</td></tr>
              {p.category ? <tr><th>Categoria</th><td>{p.category}</td></tr> : null}
              <tr><th>Disponibilidade</th><td>{ok ? 'Disponível' : 'Esgotado'}</td></tr>
              {p.stockQty != null && !p.madeToOrder ? <tr><th>Stock</th><td>{Math.floor(p.stockQty)}</td></tr> : null}
              <tr><th>IVA</th><td>{p.ivaCode}</td></tr>
              <tr><th>Preço sem IVA</th><td>{kz(p.netPrice)}</td></tr>
            </tbody></table>
          </section>

          <section id="pd-rev" className="kw-block-sec kw-reveal">
            <h2>Avaliações</h2>
            {rev && rev.count ? (
              <div className="kw-rev">
                <div className="kw-rev-sum"><b>{rev.average.toFixed(1)}</b><span className="kw-stars">{'★'.repeat(Math.round(rev.average))}{'☆'.repeat(5 - Math.round(rev.average))}</span><small>{rev.count} avaliações</small></div>
                <div className="kw-rev-bars">{[5, 4, 3, 2, 1].map((s) => { const n = rev.distribution[s - 1] ?? 0; return <div key={s}><span>{s}★</span><i><em style={{ width: `${rev.count ? (n / rev.count) * 100 : 0}%` }} /></i><small>{n}</small></div>; })}</div>
                <ul>{rev.items.slice(0, 10).map((r) => <li key={r.id}><b>{r.name}</b><span className="kw-stars">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>{r.comment ? <p>{r.comment}</p> : null}</li>)}</ul>
              </div>
            ) : <p className="kw-muted">Sem avaliações</p>}
          </section>

          <section id="pd-store" className="kw-block-sec kw-reveal">
            <h2>Loja</h2>
            <div className="kw-storecard">
              <span className="kw-avatar">{storeName.slice(0, 1).toUpperCase()}</span>
              <div><b>{storeName}</b>{rev && rev.count ? <small>{Math.round((rev.items.filter((r) => r.rating >= 4).length / Math.max(1, rev.items.length)) * 1000) / 10}% Avaliações positivas</small> : null}</div>
              {contact.phone ? <a className="kw-btn" href={`tel:${contact.phone}`}><I d={P.phone} size={15} /> {contact.phone}</a> : null}
            </div>
          </section>
        </div>

        <aside className="kw-pdp-side">{buyBox}</aside>
      </div>

      <Shelf title="Produtos similares" items={similar} render={card} />
      <Shelf title="Vistos recentemente" items={recent} render={card} />
      {love.length ? (
        <section id="pd-love" className="kw-sec">
          <header className="kw-sec-head"><h2>Você também vai gostar</h2></header>
          <div className="kw-grid6">{love.slice(0, shown).map((x) => <div key={x.code} className="kw-reveal">{card(x)}</div>)}</div>
          {shown < love.length ? <div ref={sentinel} className="kw-loader" aria-busy="true"><i /><i /><i /></div> : null}
        </section>
      ) : null}
    </div>
  );
}
