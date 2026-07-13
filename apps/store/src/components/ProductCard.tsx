import React from 'react';
import type { CatalogProduct } from '../api/types';
import { formatKz } from '../format';
import { IconImage, IconPlus } from './Icons';

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
      <div className="ax-card-img">
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <IconImage size={40} />}
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
                ? <span className="ax-tag">🟢 Pronto</span>
                : <span className="ax-tag">🍳 Sob produção</span>)
            : product.madeToOrder ? <span className="ax-tag">🍳 Sob encomenda</span>
            : lowStock ? <span className="ax-tag low">Só {product.stockQty} restam</span> : null}
        </div>
        <div className="ax-card-foot">
          <div className="ax-price">
            <span className="cur">Kz</span>
            <span className="val">{formatKz(product.grossPrice).replace(/\s*Kz\s*/i, '').trim()}</span>
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
