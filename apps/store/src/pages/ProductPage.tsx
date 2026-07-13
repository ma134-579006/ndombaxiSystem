import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogProduct } from '../api/types';
import { formatKz } from '../format';
import { IconChevronLeft, IconImage, IconMinus, IconPlus } from '../components/Icons';
import { ProductCard } from '../components/ProductCard';

/** Página de produto (PDP) estilo AliExpress: galeria com miniaturas, bloco de
 *  preço, quantidade, comprar/adicionar, garantias de envio, loja, descrição e
 *  "também pode gostar". */
export function ProductPage({ product, storeName, related, onBack, onAdd, onBuyNow, onOpen }: {
  product: CatalogProduct;
  storeName: string;
  related: CatalogProduct[];
  onBack(): void;
  onAdd(p: CatalogProduct, qty: number): void;
  onBuyNow(p: CatalogProduct, qty: number): void;
  onOpen(p: CatalogProduct): void;
}) {
  const gallery = useMemo(() => {
    const imgs = [product.imageUrl, ...(product.gallery ?? [])].filter((x): x is string => !!x);
    return imgs.length ? [...new Set(imgs)] : [];
  }, [product]);
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState(1);
  useEffect(() => { setActive(0); setQty(1); window.scrollTo({ top: 0 }); }, [product.code]);

  const main = gallery[active] ?? null;

  return (
    <div className="ax-pdp wrap">
      <button className="ax-back" onClick={onBack}><IconChevronLeft size={18} /> Voltar</button>

      <div className="ax-pdp-top">
        {/* Galeria */}
        <div className="ax-gallery">
          <div className="ax-gallery-main">
            {main ? <img src={main} alt={product.name} /> : <IconImage size={64} />}
            {!product.inStock && !product.canProduce ? <span className="ax-out lg">Esgotado</span> : null}
          </div>
          {gallery.length > 1 ? (
            <div className="ax-thumbs">
              {gallery.map((g, i) => (
                <button key={g + i} className={`ax-thumb${i === active ? ' on' : ''}`} onClick={() => setActive(i)}>
                  <img src={g} alt="" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Info + compra */}
        <div className="ax-buybox">
          <h1 className="ax-pdp-title">{product.name}</h1>

          <div className="ax-pdp-price">
            <span className="cur">Kz</span>
            <span className="val">{formatKz(product.grossPrice).replace(/\s*Kz\s*/i, '').trim()}</span>
          </div>
          <div className="ax-pdp-tax">Preço com IVA incluído</div>

          <div className="ax-assure">
            <div className="ax-assure-row"><span>🚚</span> Envio para toda Angola</div>
            <div className="ax-assure-row"><span>🛡️</span> Compra protegida — pague na recolha ou por referência</div>
            <div className="ax-assure-row"><span>↩️</span> Troca em caso de defeito</div>
          </div>

          <div className="ax-stock-line">
            {product.isProduction
              ? (product.availability === 'FREE'
                  ? <span>🟢 Pronto a servir</span>
                  : product.availability === 'BUSY'
                    ? <span className="low">🟡 Em produção — pode encomendar para produção</span>
                    : <span className="low">🔴 Esgotado — pode solicitar produção</span>)
              : product.madeToOrder
              ? <span>🍳 Sob encomenda — preparado na hora</span>
              : product.inStock
              ? (typeof product.stockQty === 'number'
                  ? <span className={product.stockQty <= 5 ? 'low' : ''}>{product.stockQty} disponível(is)</span>
                  : <span>Disponível</span>)
              : <span className="low">Esgotado</span>}
          </div>

          {product.inStock || product.canProduce ? (
            <>
              <div className="ax-qty-row">
                <span className="lbl">Quantidade</span>
                <div className="ax-stepper">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos"><IconMinus size={16} /></button>
                  <span className="q">{qty}</span>
                  <button onClick={() => setQty((q) => q + 1)} aria-label="Mais"><IconPlus size={16} /></button>
                </div>
              </div>
              {/* Produção não pronta: só "Solicitar produção" (vai a aprovação →
                  cozinha → pronto → aprovação final). Comprar agora exige stock pronto. */}
              {product.isProduction && product.availability !== 'FREE' ? (
                <div className="ax-buy-actions">
                  <button className="btn lg block buy" onClick={() => onAdd(product, qty)}>🍳 Solicitar produção</button>
                </div>
              ) : (
                <div className="ax-buy-actions">
                  <button className="btn lg block buy" onClick={() => onBuyNow(product, qty)}>Comprar agora</button>
                  <button className="btn lg block ghost" onClick={() => onAdd(product, qty)}>Adicionar ao carrinho</button>
                </div>
              )}
            </>
          ) : (
            <button className="btn lg block" disabled>Esgotado</button>
          )}

          <div className="ax-store-card">
            <div className="ax-store-ava">{(storeName || 'L').slice(0, 1).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">{storeName}</div>
              <div className="sub">Loja oficial</div>
            </div>
          </div>
        </div>
      </div>

      {/* Descrição */}
      {product.description ? (
        <div className="ax-section">
          <h2 className="ax-section-title">Descrição do produto</h2>
          <p className="ax-desc">{product.description}</p>
        </div>
      ) : null}

      {/* Relacionados */}
      {related.length > 0 ? (
        <div className="ax-section">
          <h2 className="ax-section-title">Também pode gostar</h2>
          <div className="ax-grid">
            {related.map((p) => (
              <ProductCard key={p.code} product={p} onOpen={onOpen} onAdd={(x) => onAdd(x, 1)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
