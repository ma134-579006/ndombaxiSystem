import React from 'react';
import { useStore } from '../state/StoreContext';
import { cartCount } from '../store/cart';
import { IconCart, IconStore } from './Icons';

export function Header({ onHome, onCart }: { onHome(): void; onCart(): void }) {
  const { data, cart } = useStore();
  const s = data?.settings;
  const name = s?.brand_name || data?.storeName || 'Loja';
  const count = cartCount(cart);

  return (
    <header className="header">
      <div className="wrap bar">
        <div className="brand" onClick={onHome}>
          {s?.logo_url ? (
            <img src={s.logo_url} alt={name} />
          ) : (
            <span style={{ color: 'var(--accent)' }}>
              <IconStore size={30} />
            </span>
          )}
          <div>
            <div className="nm">{name}</div>
            {s?.tagline ? <div className="tg">{s.tagline}</div> : null}
          </div>
        </div>
        <span className="spacer" />
        <button className="cart-btn" onClick={onCart} aria-label="Carrinho">
          <IconCart size={22} />
          {count > 0 ? <span className="count">{count}</span> : null}
        </button>
      </div>
    </header>
  );
}
