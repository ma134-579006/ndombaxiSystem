import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type { StockMovementRow, WarehouseRow } from '../api/types';
import { IconSearch } from '../components/Icons';

const TYPE_LABEL: Record<string, string> = {
  IN: 'Entrada', OUT: 'Saída', ADJUST: 'Acerto', TRANSFER: 'Transferência',
};
const TYPE_TONE: Record<string, string> = {
  IN: 'on', OUT: 'off', ADJUST: '', TRANSFER: '',
};

function fmtDateTime(s: string): string {
  try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; }
}

/** Movimentos de stock: consulta por nome, armazém e período. */
export function StockMovements() {
  const [rows, setRows] = useState<StockMovementRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.inventory.warehouses().then(setWarehouses).catch(() => undefined); }, []);

  const search = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await api.inventory.movements({ q: q.trim() || undefined, warehouseId: warehouseId || undefined, from: from || undefined, to: to || undefined }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar movimentos.');
    } finally { setLoading(false); }
  }, [q, warehouseId, from, to]);

  useEffect(() => { void search(); }, []); // carga inicial

  return (
    <>
      <div className="content-head">
        <h2>Movimentos de stock</h2>
        <span className="spacer" />
        <button className="btn ghost sm no-print" onClick={() => void printSectionReport()}>Imprimir</button>
      </div>

      {error ? <div className="banner danger" style={{ marginBottom: 12 }}>{error}</div> : null}

      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="grid-2">
          <div className="field"><label>Produto (nome ou código)</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto…" onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} /></div>
          <div className="field"><label>Loja</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Todos</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Data inicial</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>Data final</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <button className="btn" onClick={() => void search()} disabled={loading}>
          <IconSearch size={16} /> {loading ? 'A procurar…' : 'Pesquisar'}
        </button>
      </div>

      <div className="card">
        {loading ? <div className="loading">A carregar…</div>
          : rows.length === 0 ? <div className="empty"><p>Sem movimentos no período/filtro.</p></div>
          : (
            <table className="ptable stack">
              <thead><tr><th>Data/Hora</th><th>Produto</th><th>Operação</th><th>Qtd</th><th>Saldo</th><th>Loja</th><th>Funcionário</th><th>Observação</th></tr></thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr key={i}>
                    <td data-label="Data">{fmtDateTime(m.created_at)}</td>
                    <td data-label="Produto">{m.product_name} <span className="muted">({m.product_code})</span></td>
                    <td data-label="Operação"><span className={`pill ${TYPE_TONE[m.type] ?? ''}`}>{TYPE_LABEL[m.type] ?? m.type}</span></td>
                    <td data-label="Qtd">{Number(m.quantity) > 0 ? '+' : ''}{Number(m.quantity)}</td>
                    <td data-label="Saldo">{Number(m.balance_after)}</td>
                    <td data-label="Loja">{m.warehouse_name ?? '—'}</td>
                    <td data-label="Funcionário">{m.created_by ?? '—'}</td>
                    <td data-label="Observação">{m.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </>
  );
}
