import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { IVA_RATE, type Product, type SelfConsumption } from '../api/types';
import { formatKz } from '../format';
import { BarcodeScanner } from './BarcodeScanner';

function grossUnit(p: Product): number {
  return Number(p.unit_price) * (1 + IVA_RATE[p.iva_code] / 100);
}

/**
 * Consumo próprio do operador de caixa: pesquisa por nome ou código de barras
 * (com câmara para telemóveis), escolhe o produto e a quantidade; o sistema
 * regista o consumo e desconta-o automaticamente no salário (RH).
 */
export function SelfConsumptionModal({ products, onClose }: { products: Product[]; onClose(): void }) {
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
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

  const pickByCode = (code: string): boolean => {
    const c = code.trim().toLowerCase();
    const p = products.find((x) => (x.barcode ?? '').toLowerCase() === c || x.code.toLowerCase() === c);
    if (p) { setSelected(p); setQty(1); setScan(false); return true; }
    setErr(`Sem produto para o código ${code}.`);
    return false;
  };

  const register = async () => {
    if (!selected || busy) return;
    if (!Number.isFinite(qty) || qty <= 0) { setErr('Quantidade inválida.'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.registerConsumption(selected.id, qty);
      setMsg(`Consumo registado: ${qty}× ${selected.name} (${formatKz(r.total)}).${r.employeeLinked ? ' Será descontado no teu salário.' : ' ⚠ Sem ficha de funcionário associada — fala com o gestor para o desconto.'}`);
      setSelected(null); setQty(1); setSearch('');
      loadMine();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível registar o consumo.');
    } finally { setBusy(false); }
  };

  const pendingTotal = mine.filter((c) => c.status === 'PENDING').reduce((s, c) => s + Number(c.total), 0);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>🛒 Consumo próprio</h3>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={onClose}>Fechar</button>
        </div>
        <div className="mb" style={{ maxHeight: '74vh', overflowY: 'auto' }}>
          {msg ? <div className="banner success" style={{ marginBottom: 10 }}>{msg}</div> : null}
          {err ? <div className="banner danger" style={{ marginBottom: 10 }}>{err}</div> : null}

          {selected ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>{selected.name}</div>
              <div className="muted" style={{ fontSize: 13, margin: '2px 0 10px' }}>
                {selected.code}{selected.barcode ? ` · ${selected.barcode}` : ''} · {formatKz(grossUnit(selected))} /un
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <button className="btn ghost" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <input style={{ width: 80, textAlign: 'center' }} inputMode="numeric" value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} />
                <button className="btn ghost" onClick={() => setQty((q) => q + 1)}>+</button>
                <span className="spacer" />
                <strong>{formatKz(grossUnit(selected) * qty)}</strong>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn block" disabled={busy} onClick={() => void register()}>
                  {busy ? 'A registar…' : 'Registar consumo'}
                </button>
                <button className="btn ghost" onClick={() => setSelected(null)}>Voltar</button>
              </div>
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                <input style={{ flex: 1 }} value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar por nome ou código de barras…" autoFocus />
                <button className={`btn ${scan ? '' : 'ghost'}`} onClick={() => setScan((v) => !v)} title="Ler com a câmara">
                  📷
                </button>
              </div>

              {scan ? (
                <div style={{ marginBottom: 12 }}>
                  <BarcodeScanner continuous onDetected={(code) => pickByCode(code)} />
                </div>
              ) : null}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13, padding: 8 }}>Sem produtos para esta pesquisa.</div>
                ) : filtered.map((p) => (
                  <button key={p.id} className="list-row" style={{ textAlign: 'left', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', borderRadius: 10 }}
                    onClick={() => { setSelected(p); setQty(1); }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{p.code}{p.barcode ? ` · ${p.barcode}` : ''} · stock {Number(p.stock_qty)}</div>
                    </div>
                    <strong>{formatKz(grossUnit(p))}</strong>
                  </button>
                ))}
              </div>
            </>
          )}

          {mine.length > 0 ? (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>Os meus consumos</strong>
                <span className="spacer" />
                <span className="muted" style={{ fontSize: 13 }}>Por descontar: <strong>{formatKz(pendingTotal)}</strong></span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {mine.slice(0, 20).map((c) => (
                  <div key={c.id} className="row" style={{ fontSize: 13, gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{Number(c.quantity)}× {c.description}</span>
                    <span className="muted">{c.status === 'DEDUCTED' ? 'descontado' : 'pendente'}</span>
                    <strong>{formatKz(c.total)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
