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
    if (p) { setSelected(p); setQty(1); setScan(false); setErr(null); return true; }
    setErr(`Sem produto para o código ${code}.`);
    return false;
  };

  const register = async () => {
    if (!selected || busy) return;
    if (!Number.isFinite(qty) || qty <= 0) { setErr('Quantidade inválida.'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.registerConsumption(selected.id, qty);
      setMsg(`Registado: ${qty}× ${selected.name} (${formatKz(r.total)}).${r.employeeLinked ? ' Será descontado no teu salário.' : ' ⚠ Sem ficha de funcionário associada — fala com o gestor.'}`);
      setSelected(null); setQty(1); setSearch('');
      loadMine();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível registar o consumo.');
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

        {/* Pesquisa FIXA no topo (não rola com a lista) — escondida no detalhe */}
        {!selected ? (
          <div className="consume-search">
            <div className="field">
              <span aria-hidden style={{ opacity: .7 }}>🔎</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar por nome ou código de barras…" autoFocus />
            </div>
            <button className={`consume-cam${scan ? ' on' : ''}`} onClick={() => setScan((v) => !v)} title="Ler com a câmara">📷</button>
          </div>
        ) : null}

        <div className="consume-body">
          {msg ? <div className="banner success" style={{ marginBottom: 12 }}>{msg}</div> : null}
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

          {selected ? (
            <div className="consume-detail">
              <div className="dname">{selected.name}</div>
              <div className="dmeta">{selected.code}{selected.barcode ? ` · ${selected.barcode}` : ''} · {formatKz(grossUnit(selected))} /un</div>
              <div className="consume-qty">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">−</button>
                <input inputMode="numeric" value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} />
                <button onClick={() => setQty((q) => q + 1)} aria-label="Mais">+</button>
                <span className="tot">{formatKz(grossUnit(selected) * qty)}</span>
              </div>
              <div className="row" style={{ gap: 10, marginTop: 16 }}>
                <button className="btn ghost" onClick={() => setSelected(null)}>Voltar</button>
                <button className="btn block" disabled={busy} onClick={() => void register()}>
                  {busy ? 'A registar…' : 'Registar consumo'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {scan ? (
                <div style={{ marginBottom: 14 }}>
                  <BarcodeScanner continuous onDetected={(code) => pickByCode(code)} />
                </div>
              ) : null}

              <div className="consume-list">
                {filtered.length === 0 ? (
                  <div className="consume-empty">Sem produtos para esta pesquisa.</div>
                ) : filtered.map((p) => (
                  <button key={p.id} className="consume-item" onClick={() => { setSelected(p); setQty(1); setErr(null); }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">{p.name}</div>
                      <div className="meta">{p.code}{p.barcode ? ` · ${p.barcode}` : ''} · stock {Number(p.stock_qty)}</div>
                    </div>
                    <span className="price">{formatKz(grossUnit(p))}</span>
                  </button>
                ))}
              </div>
            </>
          )}

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
