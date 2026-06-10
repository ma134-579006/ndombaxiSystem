import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { FeedbackStats, SiteFeedbackAdmin } from '../api/types';
import { ColumnChart } from '../components/ColumnChart';
import { DonutChart } from '../components/DonutChart';
import { IconRefresh } from '../components/Icons';

/** Comentários do site (Super Admin): tudo o que a comunidade sugere, com
 *  dashboard (sentimento por votos + evolução diária). */
export function FeedbackAdmin() {
  const [items, setItems] = useState<SiteFeedbackAdmin[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.support.admin.feedback();
      setItems(r.items); setStats(r.stats); setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="content-head">
        <h2>Comentários do site</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      {stats ? (
        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-label">Total</div><div className="kpi-value">{stats.total}</div></div>
          <div className="kpi-card"><div className="kpi-label">Bem recebidos 👍</div><div className="kpi-value" style={{ color: 'var(--success)' }}>{stats.positive}</div></div>
          <div className="kpi-card"><div className="kpi-label">Mal recebidos 👎</div><div className="kpi-value" style={{ color: 'var(--danger)' }}>{stats.negative}</div></div>
          <div className="kpi-card"><div className="kpi-label">Neutros</div><div className="kpi-value">{stats.neutral}</div></div>
        </div>
      ) : null}

      {stats && stats.total > 0 ? (
        <div className="cols-2">
          <div className="card">
            <h3>Sentimento (pelos votos)</h3>
            <DonutChart
              data={[
                { label: 'Positivos', value: stats.positive },
                { label: 'Negativos', value: stats.negative },
                { label: 'Neutros', value: stats.neutral },
              ]}
              centerLabel="Comentários"
            />
          </div>
          <div className="card">
            <h3>Comentários por dia (30 dias)</h3>
            {stats.perDay.length ? (
              <ColumnChart data={stats.perDay.map((d) => ({ label: d.day.slice(5), value: d.count }))} height={210} />
            ) : <p className="muted">Sem dados.</p>}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3>Todos os comentários</h3>
        {loading ? <div className="loading">A carregar…</div>
          : items.length === 0 ? <div className="empty"><p>Ainda sem comentários.</p></div>
          : items.map((f) => (
            <div className="list-row" key={f.id}>
              <span className="fb-avatar">{(f.author_name || 'A').slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{f.author_name || 'Anónimo'} <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>· {new Date(f.created_at).toLocaleString('pt-PT')}</span></div>
                <div style={{ fontSize: 14, marginTop: 2, wordBreak: 'break-word' }}>{f.body}</div>
              </div>
              <span className="pill on">👍 {f.likes}</span>
              <span className="pill off">👎 {f.dislikes}</span>
            </div>
          ))}
      </div>
    </>
  );
}
