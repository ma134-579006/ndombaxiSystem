import React from 'react';
import { useStore } from '../state/StoreContext';
import { cartCount } from '../store/cart';
import { useCustomer } from '../store/customer';
import { IconCart, IconStore } from './Icons';
import { ThemePicker } from './ThemePicker';

function IconUser({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

export function Header({ onHome, onCart, onAccount }: { onHome(): void; onCart(): void; onAccount?(): void }) {
  const { data, cart, code } = useStore();
  const customer = useCustomer(code);
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
        <ThemePicker />
        {onAccount ? (
          <button
            className={`acct-btn${customer ? ' in' : ''}`}
            onClick={onAccount}
            aria-label="Conta"
            title={customer ? customer.customer.name : 'Entrar / Minhas encomendas'}
          >
            <IconUser size={22} />
            {customer ? <span className="dot" /> : null}
          </button>
        ) : null}
        <button className="cart-btn" onClick={onCart} aria-label="Carrinho">
          <IconCart size={22} />
          {count > 0 ? <span className="count">{count}</span> : null}
        </button>
      </div>
    </header>
  );
}
