import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CatalogProduct, PaymentMethod, SiteSettings } from '../api/types';
import { INITIAL_STORE_CODE } from '../config';
import type { CartLine } from '../store/cart';

const LS_CODE = 'ndombaxi.store.code';
const cartKey = (code: string) => `ndombaxi.store.cart.${code}`;

interface StoreData {
  storeName: string;
  settings: SiteSettings;
  products: CatalogProduct[];
  paymentMethods: PaymentMethod[];
}

interface StoreContextValue {
  code: string;
  setCode(code: string): void;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  data: StoreData | null;
  cart: CartLine[];
  addToCart(product: CatalogProduct, qty?: number): void;
  setQty(productCode: string, qty: number): void;
  removeFromCart(productCode: string): void;
  clearCart(): void;
  reload(): void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function readCart(code: string): CartLine[] {
  try {
    const raw = localStorage.getItem(cartKey(code));
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [code, setCodeState] = useState<string>(
    () => INITIAL_STORE_CODE || localStorage.getItem(LS_CODE) || '',
  );
  const [status, setStatus] = useState<StoreContextValue['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StoreData | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => (code ? readCart(code) : []));

  const setCode = useCallback((next: string) => {
    const clean = next.trim().toLowerCase();
    setCodeState(clean);
    if (clean) localStorage.setItem(LS_CODE, clean);
    setCart(clean ? readCart(clean) : []);
  }, []);

  const load = useCallback(async () => {
    if (!code) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const [site, catalog, methods] = await Promise.all([
        api.site(code),
        api.catalog(code),
        api.paymentMethods(code).catch(() => []),
      ]);
      setData({
        storeName: site.store,
        settings: site.settings,
        products: catalog.products,
        paymentMethods: methods,
      });
      setStatus('ready');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível abrir a loja.');
      setStatus('error');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  // Aplica a cor da marca da loja como cor de destaque.
  useEffect(() => {
    const accent = data?.settings.primary_color;
    if (accent) document.documentElement.style.setProperty('--accent', accent);
  }, [data]);

  // Persiste o carrinho.
  useEffect(() => {
    if (code) localStorage.setItem(cartKey(code), JSON.stringify(cart));
  }, [cart, code]);

  const addToCart = useCallback((product: CatalogProduct, qty = 1) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.code === product.code);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [...prev, { product, quantity: qty }];
    });
  }, []);

  const setQty = useCallback((productCode: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.product.code === productCode ? { ...l, quantity: qty } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const removeFromCart = useCallback(
    (productCode: string) => setCart((prev) => prev.filter((l) => l.product.code !== productCode)),
    [],
  );

  const clearCart = useCallback(() => setCart([]), []);

  const value = useMemo<StoreContextValue>(
    () => ({
      code,
      setCode,
      status,
      error,
      data,
      cart,
      addToCart,
      setQty,
      removeFromCart,
      clearCart,
      reload: () => void load(),
    }),
    [code, setCode, status, error, data, cart, addToCart, setQty, removeFromCart, clearCart, load],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore deve ser usado dentro de <StoreProvider>');
  return ctx;
}
