import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { IVA_RATE, type ConsumptionLimit, type Product, type SelfConsumption } from '../api/types';
import { formatKz } from '../format';
import { BarcodeScanner } from './BarcodeScanner';
import { VWindow } from './VWindow';
import { useAuth } from '../auth/AuthContext';

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
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<SelfConsumption[]>([]);
  const [lim, setLim] = useState<ConsumptionLimit | null>(null);

  const loadMine = () => { api.myConsumptions().then(setMine).catch(() => undefined); };
  const loadLimit = () => { api.consumptionLimit().then(setLim).catch(() => undefined); };
  useEffect(() => { loadMine(); loadLimit(); }, []);

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
      setMsg(`${r.registered} consumo(s) registado(s) — ${formatKz(r.total)}.${r.employeeLinked ? ' Será descontado no teu salário.' : ' Sem ficha de funcionário associada — fala com o gestor.'}`);
      setCart([]); setSearch('');
      loadMine(); loadLimit();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível registar os consumos.');
    } finally { setBusy(false); }
  };

  const pendingTotal = mine.filter((c) => c.status === 'PENDING').reduce((s, c) => s + Number(c.total), 0);

  const now = new Date();
  const dateTx = now.toLocaleDateString('pt-PT');
  const timeTx = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const searching = search.trim().length > 0;

  // Estrutura do "Registar autoconsumo" do POS de referência: Utilizador / Data
  // / Hora; barra "Produtos consumidos"; pesquisa; linhas; Total; Cancelar e
  // Guardar à direita. Por baixo, o histórico em tabela.
  return (
    <VWindow title="Consumo próprio" onClose={onClose}>
      <div className="vw-grid3">
        <label className="vw-f"><span>Utilizador</span><input value={user?.name || user?.email || ''} readOnly disabled /></label>
        <label className="vw-f"><span>Data do consumo</span><input value={dateTx} readOnly disabled /></label>
        <label className="vw-f"><span>Hora</span><input value={timeTx} readOnly disabled /></label>
      </div>

      {lim && lim.employeeLinked ? (
        <div className="vw-limits">
          <span>Salário <b>{formatKz(lim.monthlyPay)}</b></span>
          <span>Adiantamentos <b>{formatKz(lim.advances ?? 0)}</b></span>
          <span>Consumido <b>{formatKz(lim.consumed)}</b></span>
          <span className={lim.available <= 0 ? 'bad' : 'hi'}>Saldo disponível <b>{formatKz(Math.max(lim.available, 0))}</b></span>
        </div>
      ) : null}
      {lim && lim.employeeLinked && lim.available <= 0 ? <div className="banner danger" style={{ marginBottom: 12 }}>Atingiste o limite deste mês.</div> : null}
      {msg ? <div className="banner success" style={{ marginBottom: 12 }}>{msg}</div> : null}
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

      <div className="vw-bar">Produtos consumidos</div>
      <div className="vw-insearch">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquise os produtos a registar" autoFocus aria-label="Pesquise os produtos a registar" />
        {IS_MOBILE ? (
          <button type="button" className={`consume-cam${scan ? ' on' : ''}`} onClick={() => setScan((v) => !v)} aria-label="Ler com a câmara"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="14" r="3.4" /></svg></button>
        ) : <svg className="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></svg>}
      </div>
      {scan && IS_MOBILE ? <div style={{ margin: '10px 0' }}><BarcodeScanner continuous onDetected={(code) => pickByCode(code)} /></div> : null}

      {searching ? (
        <div className="vw-results">
          {filtered.length === 0 ? <div className="vw-empty">Sem resultados</div> : filtered.map((p) => (
            <button key={p.id} type="button" className={`vw-res${inCart(p.id) ? ' sel' : ''}`} onClick={() => { addToCart(p); setSearch(''); }}>
              <span className="nm">{p.name}<small>{p.code} · stock {Number(p.stock_qty)}</small></span>
              <b>{formatKz(grossUnit(p))}</b>
            </button>
          ))}
        </div>
      ) : null}

      {cart.length > 0 ? (
        <table className="vw-lines">
          <tbody>
            {cart.map((l) => (
              <tr key={l.product.id}>
                <td>{l.product.name}<small>{formatKz(grossUnit(l.product))} /un</small></td>
                <td className="qty">
                  <div className="consume-stepper">
                    <button type="button" onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="Menos">−</button>
                    <input inputMode="numeric" value={l.qty} onChange={(e) => setQty(l.product.id, Number(e.target.value.replace(/\D/g, '')) || 1)} />
                    <button type="button" onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="Mais">+</button>
                  </div>
                </td>
                <td className="num">{formatKz(grossUnit(l.product) * l.qty)}</td>
                <td className="rm"><button type="button" className="consume-rm" onClick={() => removeLine(l.product.id)} aria-label="Remover">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !searching ? <div className="vw-empty">Pesquise os produtos a registar</div> : null}

      <div className="vw-total"><b>Total</b><span>{cartCount} unids.</span><strong>{formatKz(cartTotal)}</strong></div>
      <div className="vw-acts">
        <button type="button" className="vw-b cancel" onClick={onClose}>Cancelar</button>
        <button type="button" className="vw-b ok" disabled={busy || cart.length === 0} onClick={() => void registerAll()}>{busy ? 'A guardar…' : 'Guardar'}</button>
      </div>

      <h3 className="vw-sec" style={{ marginTop: 34 }}>Histórico de Autoconsumos</h3>
      <table>
        <thead><tr><th>Data do consumo</th><th>Produto</th><th className="num">Nº de itens</th><th className="num">Total</th><th>Estado</th></tr></thead>
        <tbody>
          {mine.length === 0 ? <tr><td colSpan={5} className="vw-empty">Sem resultados</td></tr> : mine.slice(0, 30).map((c) => (
            <tr key={c.id}>
              <td>{new Date(c.created_at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{c.description}</td>
              <td className="num">{Number(c.quantity)}</td>
              <td className="num">{formatKz(c.total)}</td>
              <td>{c.status === 'DEDUCTED' ? 'Descontado' : 'Por descontar'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {mine.length > 0 ? <p className="vw-foot-note">Por descontar: <b>{formatKz(pendingTotal)}</b></p> : null}
    </VWindow>
  );
}
