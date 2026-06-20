import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { SaleRow } from '../api/types';
import { formatKz } from '../format';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDateTime = (s: string) => { try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; } };

/**
 * Histórico de vendas da caixa: lista as vendas por período, permite marcar
 * uma/várias (ou todas) e cancelar (estorna stock + financeiro via nota de
 * crédito, 100% registado). Fecha por cima de tudo.
 */
export function SalesHistoryModal({ onClose, onChanged, canCancel = false }: { onClose(): void; onChanged?(): void; canCancel?: boolean }) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setRows(await api.listSales(from, to)); setSel({}); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar vendas.'); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active = rows.filter((r) => r.status !== 'A');
  const allSel = active.length > 0 && active.every((r) => sel[r.id]);
  const toggleAll = () => {
    if (allSel) setSel({});
    else { const m: Record<string, boolean> = {}; active.forEach((r) => { m[r.id] = true; }); setSel(m); }
  };
  const selectedIds = Object.keys(sel).filter((k) => sel[k]);

  const cancelSelected = async () => {
    if (selectedIds.length === 0) return;
    const reason = window.prompt(`Motivo do cancelamento de ${selectedIds.length} venda(s):`, 'Cancelamento na caixa');
    if (reason == null) return;
    setBusy(true); setErr(null); setMsg(null);
    let ok = 0; let lastErr: string | null = null;
    for (const id of selectedIds) {
      try { await api.cancelInvoice(id, reason.trim() || 'Cancelamento na caixa'); ok++; }
      catch (e) { lastErr = e instanceof ApiError ? e.message : 'Falha ao cancelar uma venda.'; }
    }
    setBusy(false);
    if (ok > 0) setMsg(`${ok} venda(s) cancelada(s). Stock e financeiro revertidos (nota de crédito).`);
    if (lastErr) setErr(ok > 0 ? `Algumas falharam: ${lastErr}` : lastErr);
    await load();
    onChanged?.();
  };

  return (
    <div className="scan-overlay" onClick={onClose}>
      <div className="sales-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sm-head">
          <h2 style={{ margin: 0 }}>Histórico de vendas</h2>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><span style={{ fontSize: 20 }}>✕</span></button>
        </div>

        <div className="sm-filters">
          <label>De <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>até <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn sm" onClick={() => void load()} disabled={loading}>{loading ? 'A carregar…' : 'Filtrar'}</button>
          <span style={{ flex: 1 }} />
          {canCancel ? (
            <button className="btn sm danger" onClick={cancelSelected} disabled={busy || selectedIds.length === 0}>
              {busy ? 'A cancelar…' : `Cancelar selecionadas (${selectedIds.length})`}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>🔒 Só o gerente/gestor pode cancelar vendas.</span>
          )}
        </div>

        {err ? <div className="banner danger">{err}</div> : null}
        {msg ? <div className="banner success">{msg}</div> : null}

        <div className="sm-list">
          {rows.length === 0 && !loading ? <div className="empty">Sem vendas no período.</div> : (
            <table className="sales-table">
              <thead>
                <tr>
                  {canCancel ? <th><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todas" /></th> : null}
                  <th>Documento</th><th>Data</th><th>Produtos</th><th>Operador</th><th>Total</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cancelled = r.status === 'A';
                  return (
                    <tr key={r.id} className={cancelled ? 'cancelled' : ''}>
                      {canCancel ? <td className="sel-cell">{!cancelled ? <input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))} /> : null}</td> : null}
                      <td data-label="Documento">{r.number}</td>
                      <td data-label="Data">{fmtDateTime(r.system_entry_date)}</td>
                      <td data-label="Produtos" style={{ maxWidth: 280 }}>{r.items || '—'}</td>
                      <td data-label="Operador">{r.cashier_name || '—'}</td>
                      <td data-label="Total" style={{ fontWeight: 700 }}>{formatKz(Number(r.gross_total))}</td>
                      <td data-label="Estado">{cancelled ? <span className="pill off">Anulada</span> : <span className="pill on">Válida</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
