import React, { useState } from 'react';
import { useStore } from '../state/StoreContext';
import { cartCount } from '../store/cart';
import { useCustomer } from '../store/customer';
import { IconCart, IconSearch, IconStore } from './Icons';
import { ThemePicker } from './ThemePicker';

function IconUser({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

/** Ícone de pesquisa por imagem (lente sobre foto) — estilo Google Lens. */
function IconImageSearch({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9V6a2 2 0 0 1 2-2h3" /><path d="M21 9V6a2 2 0 0 0-2-2h-3" />
      <path d="M3 15v3a2 2 0 0 0 2 2h3" /><circle cx="12" cy="12" r="3.2" /><path d="m20.5 20.5-2.3-2.3" />
    </svg>
  );
}

/** Cabeçalho estilo AliExpress: marca + barra de pesquisa AUTOMÁTICA (filtra ao
 *  escrever, sem botão) + pesquisa por imagem + conta + carrinho. */
export function Header({ onHome, onCart, onAccount, search, onSearchChange, onSearchSubmit, onImageSearch }: {
  onHome(): void;
  onCart(): void;
  onAccount?(): void;
  search?: string;
  onSearchChange?(v: string): void;
  onSearchSubmit?(): void;
  onImageSearch?(): void;
}) {
  const { data, cart, code } = useStore();
  const customer = useCustomer(code);
  const s = data?.settings;
  const name = s?.brand_name || data?.storeName || 'Loja';
  const count = cartCount(cart);
  const [local, setLocal] = useState('');
  const value = search ?? local;
  const change = onSearchChange ?? setLocal;
  const showSearch = !!onSearchSubmit;

  return (
    <header className="ax-header">
      <div className="wrap ax-bar">
        <div className="ax-brand" onClick={onHome}>
          {s?.logo_url ? <img src={s.logo_url} alt={name} /> : <span className="ax-brand-ic"><IconStore size={26} /></span>}
          <div className="ax-brand-tx">
            <div className="nm">{name}</div>
            {s?.tagline ? <div className="tg">{s.tagline}</div> : null}
          </div>
        </div>

        {showSearch ? (
          <form className="ax-search" onSubmit={(e) => e.preventDefault()} role="search">
            <span className="ax-search-ic" aria-hidden><IconSearch size={19} /></span>
            <input
              value={value}
              onChange={(e) => change(e.target.value)}
              placeholder="Procurar produtos…"
              aria-label="Procurar"
              autoComplete="off"
            />
            {onImageSearch ? (
              <button type="button" className="ax-search-cam" onClick={onImageSearch} title="Pesquisar por imagem (foto)" aria-label="Pesquisar por imagem">
                <IconImageSearch size={20} />
              </button>
            ) : null}
          </form>
        ) : <span className="spacer" />}

        <div className="ax-actions">
          <ThemePicker />
          {onAccount ? (
            <button className={`ax-icon-btn${customer ? ' in' : ''}`} onClick={onAccount}
              title={customer ? customer.customer.name : 'Entrar / Minhas encomendas'} aria-label="Conta">
              <IconUser size={22} />
              <span className="lbl">{customer ? 'Conta' : 'Entrar'}</span>
              {customer ? <span className="dot" /> : null}
            </button>
          ) : null}
          <button className="ax-icon-btn cart" onClick={onCart} aria-label="Carrinho">
            <IconCart size={22} />
            <span className="lbl">Carrinho</span>
            {count > 0 ? <span className="count">{count > 99 ? '99+' : count}</span> : null}
          </button>
        </div>
      </div>
    </header>
  );
}
