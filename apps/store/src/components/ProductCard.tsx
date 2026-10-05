import React from 'react';
import type { CatalogProduct } from '../api/types';
import { formatKz } from '../format';
import { IconPlus } from './Icons';

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


/** Cartão de produto estilo AliExpress: imagem quadrada, título a 2 linhas,
 *  preço grande laranja, etiquetas e botão de adicionar. */
export function ProductCard({ product, onOpen, onAdd }: {
  product: CatalogProduct;
  onOpen(p: CatalogProduct): void;
  onAdd(p: CatalogProduct): void;
}) {
  const lowStock = typeof product.stockQty === 'number' && product.stockQty > 0 && product.stockQty <= 5;
  // Produção: pode encomendar-se mesmo esgotado (solicita produção → aprovação).
  const canOrder = product.inStock || !!product.canProduce;
  // Só mostra "Esgotado" se NÃO puder ser produzido (comercial sem stock).
  const showOut = !product.inStock && !product.canProduce;
  return (
    <div className="ax-card" onClick={() => onOpen(product)}>
      <div className={`ax-card-img${product.imageUrl ? '' : ' mono'}`} style={product.imageUrl ? undefined : { ['--mono' as string]: monoColor(product.name) }}>
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <span className="ax-mono" aria-hidden="true">{monoOf(product.name)}</span>}
        {showOut ? <span className="ax-out">Esgotado</span> : null}
        {product.isProduction && product.availability === 'BUSY' ? <span className="ax-out" style={{ background: '#f5a623' }}>Em produção</span> : null}
        {product.isProduction && product.availability === 'OUT' ? <span className="ax-out" style={{ background: '#e5484d' }}>Esgotado</span> : null}
      </div>
      <div className="ax-card-body">
        <div className="ax-card-name">{product.name}</div>
        <div className="ax-card-tags">
          <span className="ax-tag ship">Envio p/ Angola</span>
          {product.isProduction
            ? (product.availability === 'FREE'
                ? <span className="ax-tag">Pronto</span>
                : <span className="ax-tag">Sob produção</span>)
            : product.madeToOrder ? <span className="ax-tag">Sob encomenda</span>
            : lowStock ? <span className="ax-tag low">Só {product.stockQty} restam</span> : null}
        </div>
        <div className="ax-card-foot">
          <div className="ax-price">
            {/* Mesmo formato do resto da loja: "81.914,70 Kz" (antes "Kz 81.914,70" só nos cartões). */}
            <span className="val">{formatKz(product.grossPrice).replace(/\s*Kz\s*/i, '').trim()}</span>
            <span className="cur" style={{ marginLeft: 4 }}>Kz</span>
          </div>
          {canOrder ? (
            <button className="ax-add" onClick={(e) => { e.stopPropagation(); onAdd(product); }}
              aria-label={product.isProduction && product.availability !== 'FREE' ? 'Solicitar produção' : 'Adicionar ao carrinho'}>
              <IconPlus size={18} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
