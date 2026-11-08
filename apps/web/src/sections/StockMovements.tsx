import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type { StockMovementRow, WarehouseRow } from '../api/types';
import { IconSearch } from '../components/Icons';

const TYPE_LABEL: Record<string, string> = {
  IN: 'Entrada', OUT: 'Saída', ADJUST: 'Acerto', TRANSFER: 'Transferência',
};

function fmtDateTime(s: string): string {
  try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; }
}

/** Movimentos de stock no padrão de listagem de referência: filtros + tabela paginada. */
export function StockMovements() {
  const [rows, setRows] = useState<StockMovementRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => { api.inventory.warehouses().then(setWarehouses).catch(() => undefined); }, []);

  const search = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await api.inventory.movements({ q: q.trim() || undefined, warehouseId: warehouseId || undefined, from: from || undefined, to: to || undefined }));
      setPage(1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar movimentos.');
    } finally { setLoading(false); }
  }, [q, warehouseId, from, to]);

  // Pesquisa automática: 300 ms depois de escrever ou de mudar um filtro (sem Enter).
  useEffect(() => {
    const t = window.setTimeout(() => void search(), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const shown = type ? rows.filter((m) => m.type === type) : rows;
  const perPage = 20;
  const pageCount = Math.max(1, Math.ceil(shown.length / perPage));
  const cur = Math.min(page, pageCount);
  const pageRows = shown.slice((cur - 1) * perPage, cur * perPage);
  const sumIn = shown.reduce((s, m) => s + (Number(m.quantity) > 0 ? Number(m.quantity) : 0), 0);
  const sumOut = shown.reduce((s, m) => s + (Number(m.quantity) < 0 ? -Number(m.quantity) : 0), 0);

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Movimentos de Stock</span><span className="sep">/</span><span>Listagem</span></p>
        <span className="spacer" />
        <button className="vd-btn outline no-print" onClick={() => void printSectionReport()}>Imprimir</button>
      </div>

      <form className="vd-card vd-filters no-print" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <div className="vd-frow">
          <label className="vd-f grow"><span>Produto</span><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, referência ou código de barras" /></label>
          <label className="vd-f"><span>Loja</span>
            <select className="vd-in" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Todas</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          <label className="vd-f"><span>Operação</span>
            <select className="vd-in" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">Todas</option>
              {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
          <label className="vd-f"><span>De</span><input className="vd-in" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="vd-f"><span>Até</span><input className="vd-in" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="submit" className="vd-btn outline" disabled={loading} style={{ alignSelf: 'flex-end' }}><IconSearch size={15} /> Pesquisar</button>
        </div>
      </form>

      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="vd-card vd-tablecard">
        <div className="vd-tbar">
          <span>{shown.length.toLocaleString('pt-PT')} registos</span>
          <span className="spacer" />
          <div className="vd-sum">
            <span>Entradas <b>{sumIn.toLocaleString('pt-PT')}</b></span>
            <span>Saídas <b>{sumOut.toLocaleString('pt-PT')}</b></span>
          </div>
        </div>
        {loading ? <div className="loading">A carregar…</div>
          : pageRows.length === 0 ? <div className="vd-empty">Sem movimentos.</div>
          : (
            <div className="vd-tablewrap">
              <table className="vd-table">
                <thead><tr><th>Data</th><th>Produto</th><th className="ctr">Operação</th><th className="num">Qtd.</th><th className="num">Saldo</th><th>Loja</th><th>Utilizador</th><th>Observação</th></tr></thead>
                <tbody>
                  {pageRows.map((m, i) => {
                    const q2 = Number(m.quantity);
                    return (
                      <tr key={i} style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}>
                        <td>{fmtDateTime(m.created_at)}</td>
                        <td><strong>{m.product_name}</strong><span className="sub">{m.product_code}</span></td>
                        <td className="ctr"><span className={`vd-badge${m.type === 'OUT' ? ' bad' : m.type === 'ADJUST' ? ' warn' : m.type === 'TRANSFER' ? ' mute' : ''}`}>{TYPE_LABEL[m.type] ?? m.type}</span></td>
                        <td className="num" style={{ color: q2 < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{q2 > 0 ? '+' : ''}{q2.toLocaleString('pt-PT')}</td>
                        <td className="num">{Number(m.balance_after).toLocaleString('pt-PT')}</td>
                        <td>{m.warehouse_name ?? '—'}</td>
                        <td>{m.created_by ?? '—'}</td>
                        <td>{m.reference ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        {!loading && shown.length > 0 ? (
          <div className="vd-foot">
            <span>Página {cur} de {pageCount}</span>
            <span className="spacer" />
            {pageCount > 1 ? (
              <div className="vd-pager">
                <button onClick={() => setPage(cur - 1)} disabled={cur <= 1}>Anterior</button>
                <button className="on">{cur}</button>
                <button onClick={() => setPage(cur + 1)} disabled={cur >= pageCount}>Seguinte</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
