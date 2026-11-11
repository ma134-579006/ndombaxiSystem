import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogProduct } from '../api/types';
import { useCategories } from './Home';
import { I, P, canBuy, pct, useInfinite, useReveal } from './parts';

export interface SearchState { q: string; cat?: string; promo?: boolean }

export function Search({ products, state, card, onState }: {
  products: CatalogProduct[]; state: SearchState; card(p: CatalogProduct): React.ReactNode; onState(s: SearchState): void;
}) {
  const allCats = useCategories(products);
  const [cats, setCats] = useState<string[]>(state.cat ? [state.cat] : []);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [promo, setPromo] = useState(!!state.promo);
  const [stock, setStock] = useState(false);
  const [sort, setSort] = useState<'rel' | 'asc' | 'desc' | 'sold' | 'off'>('rel');
  const [drawer, setDrawer] = useState(false);
  const [catMenu, setCatMenu] = useState(false);
  useEffect(() => { setCats(state.cat ? [state.cat] : []); setPromo(!!state.promo); }, [state.cat, state.promo, state.q]);

  const term = state.q.trim().toLowerCase();
  // Base: produtos que batem com o termo — as contagens dos filtros vêm daqui.
  const base = useMemo(() => products.filter((p) => !term || p.name.toLowerCase().includes(term)
    || (p.description ?? '').toLowerCase().includes(term) || p.code.toLowerCase().includes(term)
    || (p.category ?? '').toLowerCase().includes(term)), [products, term]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of base) if (p.category) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [base]);
  const list = useMemo(() => {
    let r = base.filter((p) => (!cats.length || (p.category && cats.includes(p.category)))
      && (!min || p.grossPrice >= Number(min)) && (!max || p.grossPrice <= Number(max))
      && (!promo || pct(p) > 0) && (!stock || canBuy(p)));
    if (sort === 'asc') r = [...r].sort((a, b) => a.grossPrice - b.grossPrice);
    else if (sort === 'desc') r = [...r].sort((a, b) => b.grossPrice - a.grossPrice);
    else if (sort === 'sold') r = [...r].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0));
    else if (sort === 'off') r = [...r].sort((a, b) => pct(b) - pct(a));
    return r;
  }, [base, cats, min, max, promo, stock, sort]);
  const [shown, sentinel] = useInfinite(list.length, 24, `${term}|${cats.join()}|${min}|${max}|${promo}|${stock}|${sort}`);
  useReveal(shown);

  const toggleCat = (c: string) => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  const active = cats.length + (min ? 1 : 0) + (max ? 1 : 0) + (promo ? 1 : 0) + (stock ? 1 : 0);
  const clear = () => { setCats([]); setMin(''); setMax(''); setPromo(false); setStock(false); };

  const filters = (
    <>
      <details className="kw-facet" open>
        <summary>Categoria</summary>
        <div className="kw-facet-list">
          {counts.length ? counts.map(([c, n]) => (
            <label key={c} className="kw-check"><input type="checkbox" checked={cats.includes(c)} onChange={() => toggleCat(c)} /><span>{c}</span><small>({n})</small></label>
          )) : <span className="kw-muted">—</span>}
        </div>
      </details>
      <details className="kw-facet" open>
        <summary>Preço</summary>
        <div className="kw-price-range">
          <input inputMode="numeric" placeholder="Mín." aria-label="Preço mínimo" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} />
          <span>–</span>
          <input inputMode="numeric" placeholder="Máx." aria-label="Preço máximo" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
        </div>
      </details>
      <details className="kw-facet" open>
        <summary>Com desconto</summary>
        <label className="kw-check"><input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} /><span>Só com desconto</span><small>({base.filter((p) => pct(p) > 0).length})</small></label>
      </details>
      <details className="kw-facet" open>
        <summary>Disponibilidade</summary>
        <label className="kw-check"><input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} /><span>Disponível</span><small>({base.filter(canBuy).length})</small></label>
      </details>
      {active ? <button className="kw-btn kw-block" onClick={clear}>Limpar filtros</button> : null}
    </>
  );

  return (
    <>
      <div className="kw-subbar">
        <div className="kw-container kw-subbar-in">
          <button className={`kw-catbtn${catMenu ? ' on' : ''}`} onClick={() => setCatMenu((v) => !v)} aria-expanded={catMenu}><I d={P.grid} size={16} /> Categorias <I d={P.next} size={14} /></button>
          {catMenu ? (
            <div className="kw-catmenu" role="menu">
              {allCats.map((c) => <button key={c.name} role="menuitem" onClick={() => { setCatMenu(false); onState({ q: '', cat: c.name }); }}>{c.name}<small>{c.count}</small></button>)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="kw-container kw-searchpage">
        <aside className={`kw-filters${drawer ? ' open' : ''}`} aria-label="Filtros">
          <div className="kw-filters-head"><b>Filtros</b><button className="kw-x" onClick={() => setDrawer(false)} aria-label="Fechar"><I d={P.close} size={18} /></button></div>
          {filters}
        </aside>
        {drawer ? <div className="kw-scrim" onClick={() => setDrawer(false)} /> : null}
        <section className="kw-results">
          <header className="kw-results-head">
            <h1><b>{list.length}</b> resultados{state.q ? <> para <b>{state.q}</b></> : null}</h1>
            <div className="kw-results-tools">
              <button className="kw-btn kw-filter-btn" onClick={() => setDrawer(true)}><I d={P.filter} size={16} /> Filtros{active ? <i>{active}</i> : null}</button>
              <label className="kw-sort"><span>Ordenar por</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="rel">Mais relevantes</option><option value="sold">Mais vendidos</option>
                  <option value="off">Maior desconto</option><option value="asc">Menor preço</option><option value="desc">Maior preço</option>
                </select>
              </label>
            </div>
          </header>
          {list.length ? (
            <div className="kw-grid4">{list.slice(0, shown).map((p) => <div key={p.code} className="kw-reveal">{card(p)}</div>)}</div>
          ) : <div className="kw-empty">Sem resultados</div>}
          {shown < list.length ? <div ref={sentinel} className="kw-loader" aria-busy="true"><i /><i /><i /></div> : null}
        </section>
      </div>
    </>
  );
}
