import React, { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CashSession, ReportX, ShiftClose } from '../api/types';
import { copyrightLine } from '../brand';
import { formatKz, formatDateTime } from '../format';
import { IconCheck, IconClose } from './Icons';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { PaperSizeToggle } from './PaperSizeToggle';

interface Props {
  session: CashSession | null;
  /** Nº de artigos no carrinho — impede o fecho com venda por finalizar. */
  cartCount?: number;
  onOpened(): void;
  onClosed(): void;
  onClose(): void;
}

/** Abertura / fecho de turno de caixa, com conferência de dinheiro (quebra/sobra). */
export function ShiftModal({ session, cartCount = 0, onOpened, onClosed, onClose }: Props) {
  const [openingFloat, setOpeningFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<ShiftClose | null>(null);
  const [xReport, setXReport] = useState<ReportX | null>(null);

  const loadX = async () => {
    setError(null); setBusy(true);
    try { setXReport(await api.reportX()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível ler o relatório X.'); }
    finally { setBusy(false); }
  };

  const open = async () => {
    setError(null);
    const float = Number(openingFloat) || 0;
    setBusy(true);
    try {
      await api.openSession(float);
      onOpened();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível abrir o turno.');
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setError(null);
    if (cartCount > 0) {
      setError(`Tem ${cartCount} artigo(s) no carrinho por finalizar. Finalize a venda (ou limpe o carrinho) antes de fechar o turno.`);
      return;
    }
    if (counted.trim() === '') {
      setError('Indique o valor contado em dinheiro.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.closeSession(Number(counted) || 0, notes.trim() || undefined);
      setCloseResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível fechar o turno.');
    } finally {
      setBusy(false);
    }
  };

  // ── Recibo de fecho ──────────────────────────────────────
  if (closeResult) {
    const r = closeResult;
    const tone = r.verdict === 'OK' ? 'var(--success)' : r.verdict === 'QUEBRA' ? 'var(--danger)' : 'var(--warning)';
    return (
      <div className="modal-bg" onClick={() => { onClosed(); }}>
        <div className="card receipt" onClick={(e) => e.stopPropagation()}>
          <div className="r-head" style={{ background: 'var(--surface-2)' }}>
            <div className="num">Fecho de turno</div>
            <div className="sub">{r.openedByName} · {formatDateTime()}</div>
          </div>
          <div className="r-body">
            <div className="banner" style={{ marginBottom: 12, justifyContent: 'center', background: 'transparent', border: `1px solid ${tone}`, color: tone, fontSize: 16, fontWeight: 900 }}>
              {r.verdict === 'OK' ? '✓ CAIXA CERTO' : r.verdict === 'QUEBRA' ? `QUEBRA DE CAIXA ${formatKz(Math.abs(r.difference))}` : `SOBRA ${formatKz(r.difference)}`}
            </div>
            <div className="kv"><span className="k">Fundo inicial</span><span className="v">{formatKz(r.openingFloat)}</span></div>
            <div className="kv"><span className="k">Vendas (total)</span><span className="v">{formatKz(r.salesTotal)} · {r.salesCount}</span></div>
            <div className="kv"><span className="k">Vendas em numerário</span><span className="v">{formatKz(r.cashSales)}</span></div>
            {r.cashIn > 0 ? <div className="kv"><span className="k">Reforços</span><span className="v">{formatKz(r.cashIn)}</span></div> : null}
            {r.cashOut > 0 ? <div className="kv"><span className="k">Sangrias</span><span className="v">−{formatKz(r.cashOut)}</span></div> : null}
            <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10 }}>
              <span className="k">Esperado na gaveta</span><span className="v">{formatKz(r.expected)}</span>
            </div>
            <div className="kv"><span className="k">Contado (físico)</span><span className="v">{formatKz(r.counted)}</span></div>
            <div className="kv"><span className="k">Diferença</span><span className="v" style={{ color: tone }}>{formatKz(r.difference)}</span></div>

            {r.products.length > 0 ? (
              <div className="legend" style={{ textAlign: 'left' }}>
                <strong>Produtos vendidos no turno:</strong>
                {r.products.map((p) => (
                  <div key={p.productCode}>{p.quantity}× {p.description} — {formatKz(p.grossTotal)}</div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="receipt-credit">{copyrightLine()}</div>
          <PaperSizeToggle />
          <div className="r-foot" style={{ display: 'flex', gap: 10 }}>
            <button className="btn ghost lg" style={{ flex: 1 }} onClick={() => window.print()}>Imprimir</button>
            <button className="btn lg" style={{ flex: 1 }} onClick={onClosed} autoFocus>Concluir</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Relatório X (leitura do turno sem fechar) ────────────
  if (xReport) {
    const x = xReport;
    const PT: Record<string, string> = {
      CASH: 'Numerário', CARD: 'Multicaixa/Cartão', TRANSFER: 'Transferência',
      REFERENCE: 'Referência', EXPRESS: 'Multicaixa Express', CREDIT: 'A crédito',
    };
    return (
      <div className="modal-bg" onClick={() => setXReport(null)}>
        <div className="card receipt" onClick={(e) => e.stopPropagation()}>
          <div className="r-head" style={{ background: 'var(--surface-2)' }}>
            <div className="num">Relatório X</div>
            <div className="sub">{x.openedByName} · {formatDateTime()}</div>
          </div>
          <div className="r-body">
            <div className="banner info" style={{ marginBottom: 12, justifyContent: 'center' }}>Leitura do turno (sem fechar)</div>
            <div className="kv"><span className="k">Fundo inicial</span><span className="v">{formatKz(x.openingFloat)}</span></div>
            <div className="kv"><span className="k">Vendas (total)</span><span className="v">{formatKz(x.salesTotal)} · {x.salesCount}</span></div>
            {Object.entries(x.byPayment).map(([pt, v]) => (
              <div className="kv" key={pt}><span className="k" style={{ paddingLeft: 10 }}>· {PT[pt] ?? pt}</span><span className="v">{formatKz(v)}</span></div>
            ))}
            {x.cashIn > 0 ? <div className="kv"><span className="k">Reforços</span><span className="v">{formatKz(x.cashIn)}</span></div> : null}
            {x.cashOut > 0 ? <div className="kv"><span className="k">Sangrias</span><span className="v">−{formatKz(x.cashOut)}</span></div> : null}
            <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10 }}>
              <span className="k">Esperado em numerário</span><span className="v grand">{formatKz(x.expectedCash)}</span>
            </div>
          </div>
          <div className="receipt-credit">{copyrightLine()}</div>
          <PaperSizeToggle />
          <div className="r-foot" style={{ display: 'flex', gap: 10 }}>
            <button className="btn ghost lg" style={{ flex: 1 }} onClick={() => window.print()}>Imprimir</button>
            <button className="btn lg" style={{ flex: 1 }} onClick={() => setXReport(null)} autoFocus>Voltar</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Abrir turno ──────────────────────────────────────────
  if (!session) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, padding: 22 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Abrir turno de caixa</h2>
            <span className="spacer" />
            <button className="trash" onClick={onClose}><IconClose size={22} /></button>
          </div>
          {error ? <div className="banner danger" style={{ marginBottom: 12 }}>{error}</div> : null}
          <KeyboardInput label="Fundo de troco inicial (Kz)" value={openingFloat} onChange={setOpeningFloat} numeric placeholder="0" onSubmit={open} />
          <button className="btn success lg block" style={{ marginTop: 14 }} onClick={open} disabled={busy}>
            {busy ? 'A abrir…' : 'Abrir turno'}
          </button>
        </div>
      </div>
    );
  }

  // ── Fechar turno ─────────────────────────────────────────
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, padding: 22 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Fechar turno</h2>
          <span className="spacer" />
          <button className="trash" onClick={onClose}><IconClose size={22} /></button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Aberto por {session.opened_by_name} · {new Date(session.opened_at).toLocaleString('pt-PT')}
        </p>
        {error ? <div className="banner danger" style={{ marginBottom: 12 }}>{error}</div> : null}
        {cartCount > 0 ? (
          <div className="banner warn" style={{ marginBottom: 12 }}>
            ⚠️ Há {cartCount} artigo(s) no carrinho por finalizar. Finalize a venda (ou limpe o carrinho) antes de fechar o turno.
          </div>
        ) : null}
        <KeyboardInput label="Dinheiro contado na gaveta (Kz)" value={counted} onChange={setCounted} numeric placeholder="0" onSubmit={close} />
        <KeyboardInput label="Observações (opcional)" value={notes} onChange={setNotes} placeholder="ex.: nota sobre o turno" />
        <button className="btn ghost lg block" style={{ marginTop: 12 }} onClick={loadX} disabled={busy}>
          Relatório X (ler sem fechar)
        </button>
        <button className="btn danger lg block" style={{ marginTop: 10 }} onClick={close} disabled={busy || cartCount > 0}>
          {busy ? 'A fechar…' : 'Fechar turno e conferir (Z)'}
        </button>
      </div>
    </div>
  );
}
