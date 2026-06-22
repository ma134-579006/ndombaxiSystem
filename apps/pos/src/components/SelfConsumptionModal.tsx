import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { IVA_RATE, type Product, type SelfConsumption } from '../api/types';
import { formatKz } from '../format';
import { BarcodeScanner } from './BarcodeScanner';

function grossUnit(p: Product): number {
  return Number(p.unit_price) * (1 + IVA_RATE[p.iva_code] / 100);
}

/** A câmara/scanner só faz sentido no telemóvel/tablet (tem câmara traseira e
 *  ecrã tátil). No desktop usa-se a pesquisa por nome/código. */
const IS_MOBILE = typeof navigator !== 'undefined' && (
  /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
);

interface CartLine { product: Product; qty: number }

/**
 * Consumo próprio do operador de caixa: pesquisa por nome ou código de barras
 * (câmara no telemóvel), SELECIONA VÁRIOS produtos (carrinho) e regista tudo de
 * uma vez; o sistema baixa o stock e desconta no salário (RH).
 */
export function SelfConsumptionModal({ products, onClose }: { products: Product[]; onClose(): void }) {
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<SelfConsumption[]>([]);

  const loadMine = () => { api.myConsumptions().then(setMine).catch(() => undefined); };
  useEffect(() => { loadMine(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q),
    ).slice(0, 60);
  }, [products, search]);

  const addToCart = (p: Product) => {
    setErr(null); setMsg(null);
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === p.id);
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; }
      return [...prev, { product: p, qty: 1 }];
    });
  };
  const setQty = (id: string, qty: number) =>
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.product.id !== id));

  const pickByCode = (code: string): boolean => {
    const c = code.trim().toLowerCase();
    const p = products.find((x) => (x.barcode ?? '').toLowerCase() === c || x.code.toLowerCase() === c);
    if (p) { addToCart(p); return true; }
    setErr(`Sem produto para o código ${code}.`);
    return false;
  };

  const cartTotal = cart.reduce((s, l) => s + grossUnit(l.product) * l.qty, 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const inCart = (id: string) => cart.some((l) => l.product.id === id);

  const registerAll = async () => {
    if (cart.length === 0 || busy) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.registerConsumptions(cart.map((l) => ({ productId: l.product.id, quantity: l.qty })));
      setMsg(`${r.registered} consumo(s) registado(s) — ${formatKz(r.total)}.${r.employeeLinked ? ' Será descontado no teu salário.' : ' ⚠ Sem ficha de funcionário associada — fala com o gestor.'}`);
      setCart([]); setSearch('');
      loadMine();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível registar os consumos.');
    } finally { setBusy(false); }
  };

  const pendingTotal = mine.filter((c) => c.status === 'PENDING').reduce((s, c) => s + Number(c.total), 0);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="consume-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="consume-head">
          <h3>🛒 Consumo próprio</h3>
          <button className="x" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        {/* Pesquisa FIXA no topo (não rola com a lista) */}
        <div className="consume-search">
          <div className="field">
            <span aria-hidden style={{ opacity: .7 }}>🔎</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por nome ou código de barras…" autoFocus />
          </div>
          {IS_MOBILE ? (
            <button className={`consume-cam${scan ? ' on' : ''}`} onClick={() => setScan((v) => !v)} title="Ler com a câmara">📷</button>
          ) : null}
        </div>

        <div className="consume-body">
          {msg ? <div className="banner success" style={{ marginBottom: 12 }}>{msg}</div> : null}
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

          {scan && IS_MOBILE ? (
            <div style={{ marginBottom: 14 }}>
              <BarcodeScanner continuous onDetected={(code) => pickByCode(code)} />
            </div>
          ) : null}

          {/* Carrinho de seleção (vários produtos) */}
          {cart.length > 0 ? (
            <div className="consume-cart">
              <div className="consume-cart-head">Selecionados ({cart.length})</div>
              {cart.map((l) => (
                <div key={l.product.id} className="consume-cart-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{l.product.name}</div>
                    <div className="meta">{formatKz(grossUnit(l.product))} /un</div>
                  </div>
                  <div className="consume-stepper">
                    <button onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="Menos">−</button>
                    <input inputMode="numeric" value={l.qty}
                      onChange={(e) => setQty(l.product.id, Number(e.target.value.replace(/\D/g, '')) || 1)} />
                    <button onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="Mais">+</button>
                  </div>
                  <strong style={{ width: 92, textAlign: 'right' }}>{formatKz(grossUnit(l.product) * l.qty)}</strong>
                  <button className="consume-rm" onClick={() => removeLine(l.product.id)} aria-label="Remover">✕</button>
                </div>
              ))}
              <div className="consume-cart-foot">
                <button className="btn ghost sm" onClick={() => setCart([])}>Limpar</button>
                <span className="spacer" />
                <span className="muted" style={{ fontSize: 13 }}>Total</span>
                <strong style={{ fontSize: 18 }}>{formatKz(cartTotal)}</strong>
              </div>
              <button className="btn block" style={{ marginTop: 10 }} disabled={busy} onClick={() => void registerAll()}>
                {busy ? 'A registar…' : `Registar consumo (${cartCount})`}
              </button>
            </div>
          ) : null}

          {/* Lista de produtos — toca para adicionar */}
          <div className="consume-list">
            {filtered.length === 0 ? (
              <div className="consume-empty">Sem produtos para esta pesquisa.</div>
            ) : filtered.map((p) => (
              <button key={p.id} className={`consume-item${inCart(p.id) ? ' sel' : ''}`} onClick={() => addToCart(p)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nm">{p.name}</div>
                  <div className="meta">{p.code}{p.barcode ? ` · ${p.barcode}` : ''} · stock {Number(p.stock_qty)}</div>
                </div>
                <span className="price">{formatKz(grossUnit(p))}</span>
                <span className="consume-add" aria-hidden>{inCart(p.id) ? '✓' : '+'}</span>
              </button>
            ))}
          </div>

          {mine.length > 0 ? (
            <div className="consume-mine">
              <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 14 }}>Os meus consumos</strong>
                <span className="spacer" />
                <span className="muted" style={{ fontSize: 13 }}>Por descontar: <strong>{formatKz(pendingTotal)}</strong></span>
              </div>
              {mine.slice(0, 20).map((c) => (
                <div key={c.id} className="consume-mine-row">
                  <span style={{ flex: 1, minWidth: 0 }}>{Number(c.quantity)}× {c.description}</span>
                  <span className={`consume-tag${c.status === 'DEDUCTED' ? ' done' : ''}`}>{c.status === 'DEDUCTED' ? 'descontado' : 'pendente'}</span>
                  <strong>{formatKz(c.total)}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
