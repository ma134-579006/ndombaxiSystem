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
  return (
    <div className="ax-card" onClick={() => onOpen(product)}>
      <div className="ax-card-img">
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <IconImage size={40} />}
        {!product.inStock ? <span className="ax-out">Esgotado</span> : null}
      </div>
      <div className="ax-card-body">
        <div className="ax-card-name">{product.name}</div>
        <div className="ax-price">
          <span className="cur">Kz</span>
          <span className="val">{formatKz(product.grossPrice).replace(/\s*Kz\s*/i, '').trim()}</span>
        </div>
        <div className="ax-card-tags">
          <span className="ax-tag ship">Envio p/ Angola</span>
          {lowStock ? <span className="ax-tag low">Só {product.stockQty} restam</span> : null}
        </div>
        {product.inStock ? (
          <button className="ax-add" onClick={(e) => { e.stopPropagation(); onAdd(product); }} aria-label="Adicionar ao carrinho">
            <IconPlus size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
