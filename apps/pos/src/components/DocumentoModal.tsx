import React, { useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { IVA_RATE, type EmittedInvoice, type Product } from '../api/types';
import { formatKz } from '../format';

function grossUnit(p: Product): number {
  return Number(p.unit_price) * (1 + IVA_RATE[p.iva_code] / 100);
}

interface CartLine { product: Product; qty: number }

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * "Documento" — fatura/recibo de uma compra de um DIA ANTERIOR (ex.: dia sem luz
 * ou com problema no sistema). Emite-se HOJE (mantém a cadeia fiscal/hash AGT),
 * mas regista a DATA DA COMPRA ORIGINAL no documento. Nível enterprise e
 * sincronizável (entra nas Vendas e na contabilidade como qualquer documento).
 */
export function DocumentoModal({ products, onClose }: { products: Product[]; onClose(): void }) {
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [docType, setDocType] = useState<'FT' | 'FS'>('FS');
  const [payment, setPayment] = useState<'CASH' | 'CARD'>('CASH');
  const [saleDate, setSaleDate] = useState(TODAY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<EmittedInvoice | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q),
    ).slice(0, 60);
  }, [products, search]);

  const add = (p: Product) => {
    setErr(null);
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === p.id);
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; }
      return [...prev, { product: p, qty: 1 }];
    });
  };
  const setQty = (id: string, qty: number) =>
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.product.id !== id));
  const inCart = (id: string) => cart.some((l) => l.product.id === id);
  const total = cart.reduce((s, l) => s + grossUnit(l.product) * l.qty, 0);

  const emit = async () => {
    setErr(null);
    if (cart.length === 0) { setErr('Adiciona pelo menos um produto.'); return; }
    if (!saleDate) { setErr('Indica a data da compra original.'); return; }
    if (saleDate > TODAY) { setErr('A data da compra não pode ser no futuro.'); return; }
    setBusy(true);
    try {
      const r = await api.emitInvoice({
        docType,
        paymentType: payment,
        operationDate: saleDate,
        lines: cart.map((l) => ({ productCode: l.product.code, quantity: l.qty })),
      });
      setDone(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível emitir o documento.');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="consume-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="consume-head"><h3>📄 Documento emitido</h3><button className="x" onClick={onClose} aria-label="Fechar">✕</button></div>
          <div className="consume-body" style={{ textAlign: 'center' }}>
            <div className="banner success" style={{ marginBottom: 14 }}>Documento emitido com sucesso.</div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{done.number}</div>
            <div className="muted" style={{ marginTop: 4 }}>Total {formatKz(done.grossTotal)}</div>
            <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
              Compra de {new Date(saleDate + 'T00:00:00').toLocaleDateString('pt-PT')} · emitido hoje (data fiscal).
              Podes imprimi-lo a partir de <strong>Vendas</strong>.
            </p>
            <button className="btn block" style={{ marginTop: 12 }} onClick={onClose}>Concluir</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="consume-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="consume-head">
          <h3>📄 Documento (compra de outro dia)</h3>
          <button className="x" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="consume-search">
          <div className="field">
            <span aria-hidden style={{ opacity: .7 }}>🔎</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar produto por nome ou código…" autoFocus />
          </div>
        </div>

        <div className="consume-body">
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

          {/* Opções do documento */}
          <div className="doc-opts">
            <div className="doc-row">
              <label className="adv-label" style={{ margin: 0 }}>Data da compra original</label>
              <input className="doc-date" type="date" max={TODAY} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </div>
            <div className="doc-row">
              <span className="adv-label" style={{ margin: 0 }}>Tipo</span>
              <div className="seg">
                <button className={docType === 'FS' ? 'on' : ''} onClick={() => setDocType('FS')}>Fatura-Recibo</button>
                <button className={docType === 'FT' ? 'on' : ''} onClick={() => setDocType('FT')}>Fatura</button>
              </div>
            </div>
            <div className="doc-row">
              <span className="adv-label" style={{ margin: 0 }}>Pagamento</span>
              <div className="seg">
                <button className={payment === 'CASH' ? 'on' : ''} onClick={() => setPayment('CASH')}>Numerário</button>
                <button className={payment === 'CARD' ? 'on' : ''} onClick={() => setPayment('CARD')}>Cartão/TPA</button>
              </div>
            </div>
          </div>

          {cart.length > 0 ? (
            <div className="consume-cart">
              <div className="consume-cart-head">No documento ({cart.length})</div>
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
                <strong style={{ fontSize: 18 }}>{formatKz(total)}</strong>
              </div>
              <button className="btn block" style={{ marginTop: 10 }} disabled={busy} onClick={() => void emit()}>
                {busy ? 'A emitir…' : `Emitir documento (${formatKz(total)})`}
              </button>
            </div>
          ) : null}

          <div className="consume-list">
            {filtered.length === 0 ? (
              <div className="consume-empty">Sem produtos para esta pesquisa.</div>
            ) : filtered.map((p) => (
              <button key={p.id} className={`consume-item${inCart(p.id) ? ' sel' : ''}`} onClick={() => add(p)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nm">{p.name}</div>
                  <div className="meta">{p.code}{p.barcode ? ` · ${p.barcode}` : ''}</div>
                </div>
                <span className="price">{formatKz(grossUnit(p))}</span>
                <span className="consume-add" aria-hidden>{inCart(p.id) ? '✓' : '+'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
