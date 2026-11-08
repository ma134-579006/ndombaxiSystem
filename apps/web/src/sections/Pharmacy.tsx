import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PharmacyBatch } from '../api/types';
import { IconSearch } from '../components/Icons';

const fmtDate = (s: string) => { try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-PT'); } catch { return s; } };

/**
 * Farmácia — controlo de validade (lotes), no padrão de listagem de referência:
 * migalhas + filtros (prazo, estado, pesquisa) + tabela paginada + resumo.
 */
export function Pharmacy() {
  const [kpi, setKpi] = useState<{ expiring: number; expired: number; prescription: number; lowStock: number } | null>(null);
  const [days, setDays] = useState(30);
  const [state, setState] = useState<'ALL' | 'EXPIRED' | 'SOON' | 'OK'>('ALL');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PharmacyBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.pharmacy.expiring(days)); } catch { setRows([]); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { api.pharmacy.metrics().then(setKpi).catch(() => undefined); }, []);
  useEffect(() => { void load(); }, [load]);

  const lvl = (b: PharmacyBatch) => (b.days_left < 0 ? 'EXPIRED' : b.days_left <= 7 ? 'SOON' : 'OK');
  const term = q.trim().toLowerCase();
  const shown = rows.filter((b) => (state === 'ALL' || lvl(b) === state)
    && (!term || `${b.product_name} ${b.product_code ?? ''} ${b.active_ingredient ?? ''} ${b.batch_code ?? ''}`.toLowerCase().includes(term)));
  const perPage = 20;
  const pageCount = Math.max(1, Math.ceil(shown.length / perPage));
  const cur = Math.min(page, pageCount);
  const pageRows = shown.slice((cur - 1) * perPage, cur * perPage);

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Farmácia</span><span className="sep">/</span><span>Validade e lotes</span></p>
        <span className="spacer" />
      </div>

      <form className="vd-card vd-filters" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <div className="vd-seg" role="tablist" aria-label="Prazo">
            {[15, 30, 60, 90].map((d) => (
              <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? 'on' : ''} onClick={() => { setDays(d); setPage(1); }}>{d} dias</button>
            ))}
          </div>
          <div className="vd-seg" role="tablist" aria-label="Estado">
            {([['ALL', 'Todos'], ['EXPIRED', 'Expirados'], ['SOON', '≤ 7 dias'], ['OK', 'Dentro do prazo']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={state === k} className={state === k ? 'on' : ''} onClick={() => { setState(k); setPage(1); }}>{l}</button>
            ))}
          </div>
          <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Pesquisar por produto, código, princípio ativo ou lote" aria-label="Pesquisar lotes" /></label>
          <button type="submit" className="vd-btn outline"><IconSearch size={15} /> Pesquisar</button>
        </div>
      </form>

      <div className="vd-card vd-tablecard">
        <div className="vd-tbar">
          <span>{shown.length.toLocaleString('pt-PT')} registos</span>
          <span className="spacer" />
          {kpi ? (
            <div className="vd-sum">
              <span>A expirar <b>{kpi.expiring}</b></span>
              <span>Expirados <b style={kpi.expired ? { color: 'var(--danger)' } : undefined}>{kpi.expired}</b></span>
              <span>Exigem receita <b>{kpi.prescription}</b></span>
              <span>Stock baixo <b>{kpi.lowStock}</b></span>
            </div>
          ) : null}
        </div>
        {loading ? <div className="loading">A carregar…</div> : pageRows.length === 0 ? (
          <div className="vd-empty">Sem lotes.</div>
        ) : (
          <div className="vd-tablewrap">
            <table className="vd-table">
              <thead><tr>
                <th>Produto</th><th>Código</th><th>Princípio ativo</th><th>Lote</th><th className="num">Quantidade</th><th>Validade</th><th className="ctr">Estado</th>
              </tr></thead>
              <tbody>
                {pageRows.map((b, i) => {
                  const l = lvl(b);
                  return (
                    <tr key={b.id} style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}>
                      <td><strong>{b.product_name}</strong></td>
                      <td>{b.product_code || '—'}</td>
                      <td>{b.active_ingredient || '—'}</td>
                      <td>{b.batch_code || '—'}</td>
                      <td className="num">{Number(b.quantity).toLocaleString('pt-PT')}</td>
                      <td>{fmtDate(b.expiry_date)}</td>
                      <td className="ctr">
                        <span className={`vd-badge${l === 'EXPIRED' ? ' bad' : l === 'SOON' ? ' warn' : ''}`}>
                          {l === 'EXPIRED' ? 'Expirado' : b.days_left === 0 ? 'Expira hoje' : `${b.days_left} dia(s)`}
                        </span>
                      </td>
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
