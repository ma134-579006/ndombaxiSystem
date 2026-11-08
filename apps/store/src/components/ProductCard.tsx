import React from 'react';
import type { CatalogProduct } from '../api/types';
import { formatKz } from '../format';
import { IconCart, IconHeart, IconTruck } from './Icons';
import { useStore } from '../state/StoreContext';
import { toggleFavorite, usePrefs } from '../store/prefs';
import { Stars } from './Reviews';

/** Iniciais do produto (sem foto) e cor estável — iguais às do painel. */
function monoOf(name: string): string {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => /\p{L}/u.test(x));
  if (!w.length) return (name.trim()[0] ?? '?').toUpperCase();
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}
const MONO = ['#2430E8', '#4338CA', '#0E7490', '#0F766E', '#6D28D9', '#BE185D', '#B45309', '#334155'];
function monoColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONO[h % MONO.length];
}


/** "1,2 mil" a partir de mil — como os marketplaces mostram as vendas. */
export function soldLabel(n: number): string {
  if (n >= 1000) return `${(Math.floor(n / 100) / 10).toLocaleString('pt-PT')} mil+ vendidos`;
  return `${n} vendido${n === 1 ? '' : 's'}`;
}

const kz = (v: number) => formatKz(v).replace(/\s*Kz\s*/i, '').trim();

/** Cartão de produto estilo marketplace: imagem com favorito, selo de desconto
 *  e carrinho; título a 2 linhas; vendidos; preço com o antigo riscado. */
export function ProductCard({ product, onOpen, onAdd }: {
  product: CatalogProduct;
  onOpen(p: CatalogProduct): void;
  onAdd(p: CatalogProduct): void;
}) {
  const { code } = useStore();
  const { favorites } = usePrefs(code);
  const fav = favorites.includes(product.code);
  const lowStock = typeof product.stockQty === 'number' && product.stockQty > 0 && product.stockQty <= 5;
  // Produção: pode encomendar-se mesmo esgotado (solicita produção → aprovação).
  const canOrder = product.inStock || !!product.canProduce;
  // Só mostra "Esgotado" se NÃO puder ser produzido (comercial sem stock).
  const showOut = !product.inStock && !product.canProduce;
  const promo = product.promo && product.listPrice && product.listPrice > product.grossPrice ? product.promo : null;
  return (
    <div className="ax-card" onClick={() => onOpen(product)}>
      <div className={`ax-card-img${product.imageUrl ? '' : ' mono'}`} style={product.imageUrl ? undefined : { ['--mono' as string]: monoColor(product.name) }}>
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <span className="ax-mono" aria-hidden="true">{monoOf(product.name)}</span>}
        {showOut ? <span className="ax-out">Esgotado</span> : null}
        {product.isProduction && product.availability === 'BUSY' ? <span className="ax-out" style={{ background: '#f5a623' }}>Em produção</span> : null}
        {product.isProduction && product.availability === 'OUT' ? <span className="ax-out" style={{ background: '#e5484d' }}>Esgotado</span> : null}
        {promo ? <span className="ax-off">-{promo.percent}%</span> : null}
        <button className={`ax-fav${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(code, product.code); }}>
          <IconHeart size={17} />
        </button>
        {canOrder ? (
          <button className="ax-add ax-add-img" onClick={(e) => { e.stopPropagation(); onAdd(product); }}
            aria-label={product.isProduction && product.availability !== 'FREE' ? 'Solicitar produção' : 'Adicionar ao carrinho'}>
            <IconCart size={18} />
          </button>
        ) : null}
        {promo ? <span className="ax-ribbon">{promo.name}</span> : null}
      </div>
      <div className="ax-card-body">
        <div className="ax-card-name">{product.name}</div>
        {product.sold || product.reviews ? (
          <div className="ax-sold">
            {product.sold ? soldLabel(product.sold) : null}
            {product.sold && product.reviews ? <span className="sep" aria-hidden>|</span> : null}
            {product.reviews ? <><Stars value={product.rating ?? 0} /> <span>{(product.rating ?? 0).toLocaleString('pt-PT')}</span></> : null}
          </div>
        ) : null}
        <div className="ax-price">
          {/* Mesmo formato do resto da loja: "81.914,70 Kz". */}
          <span className="val">{kz(product.grossPrice)}</span>
          <span className="cur">Kz</span>
          {promo ? <s className="was">{kz(product.listPrice!)} Kz</s> : null}
        </div>
        <div className="ax-card-tags">
          <span className="ax-tag ship"><IconTruck size={12} /> Envio p/ Angola</span>
          {product.isProduction
            ? (product.availability === 'FREE'
                ? <span className="ax-tag">Pronto</span>
                : <span className="ax-tag">Sob produção</span>)
            : product.madeToOrder ? <span className="ax-tag">Sob encomenda</span>
            : lowStock ? <span className="ax-tag low">Só {product.stockQty} restam</span> : null}
        </div>
      </div>
    </div>
  );
}
