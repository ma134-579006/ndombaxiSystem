import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { PlatformKpis, PlatformSeriesPoint, RecentCompany } from '../api/types';
import { StatusBadge } from '../components/ui';
import { IconBuilding, IconCard, IconRefresh, IconStar } from '../components/Icons';
import { formatDate } from '../format';

function kz(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + 'M Kz';
  if (n >= 1_000) return (n / 1_000).toLocaleString('pt-PT', { maximumFractionDigits: 0 }) + 'k Kz';
  return n.toLocaleString('pt-PT') + ' Kz';
}

/** Dashboard GLOBAL da plataforma (Super Admin) — KPIs + gráfico + atividade, ao vivo. */
export function PlatformDashboard() {
  const [kpis, setKpis] = useState<PlatformKpis | null>(null);
  const [series, setSeries] = useState<PlatformSeriesPoint[]>([]);
  const [recent, setRecent] = useState<RecentCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [k, s, r] = await Promise.all([
        api.platformDashboard.kpis(),
        api.platformDashboard.series(14),
        api.platformDashboard.recentCompanies(8),
      ]);
      setKpis(k); setSeries(s); setRecent(r); setError(null);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o dashboard.');
    }
  }, []);

  // Tempo real: refrescar a cada 20s (como o dashboard do gestor).
  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 20_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  const maxBar = Math.max(1, ...series.map((p) => p.companies + p.subscriptions));

  return (
    <>
      <div className="content-head">
        <h2>Visão geral da plataforma</h2>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="live-dot" /> Ao vivo{lastUpdate ? ` · ${lastUpdate.toLocaleTimeString('pt-PT')}` : ''}
        </span>
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard icon={<IconBuilding size={20} />} label="Empresas" value={kpis ? String(kpis.companies.total) : '—'}
          sub={kpis ? `${kpis.companies.active} activas · ${kpis.companies.pending} pendentes` : ''} tone="primary" />
        <KpiCard icon={<IconStar size={20} />} label="Receita mensal activa" value={kpis ? kz(kpis.revenue.activeMonthlyKz) : '—'}
          sub={kpis ? `${kpis.subscriptions.active} subscrições activas` : ''} tone="success" />
        <KpiCard icon={<IconCard size={20} />} label="A aguardar pagamento" value={kpis ? kz(kpis.revenue.pendingKz) : '—'}
          sub={kpis ? `${kpis.subscriptions.inReview} p/ rever · ${kpis.subscriptions.pendingPayment} por pagar` : ''} tone="warning" />
        <KpiCard icon={<IconBuilding size={20} />} label="Novas (7 dias)" value={kpis ? String(kpis.companies.new7d) : '—'}
          sub={kpis ? `${kpis.companies.newToday} hoje` : ''} tone="violet" />
      </div>

      {/* Gráfico: novas empresas + subscrições por dia */}
      <div className="card">
        <h3>Crescimento (últimos 14 dias)</h3>
        {series.length === 0 ? (
          <p className="muted">Sem dados ainda.</p>
        ) : (
          <div className="bar-chart">
            {series.map((p) => {
              const total = p.companies + p.subscriptions;
              return (
                <div className="bar-col" key={p.day} title={`${p.day}: ${p.companies} empresas, ${p.subscriptions} subscrições`}>
                  <div className="bar-stack" style={{ height: `${(total / maxBar) * 100}%` }}>
                    <div className="bar-seg subs" style={{ flex: p.subscriptions }} />
                    <div className="bar-seg comp" style={{ flex: p.companies }} />
                  </div>
                  <span className="bar-x">{p.day.slice(8)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="legend-row">
          <span><span className="dot comp" /> Empresas</span>
          <span><span className="dot subs" /> Subscrições</span>
        </div>
      </div>

      <div className="cols-2">
        {/* Planos */}
        <div className="card">
          <h3>Empresas por plano</h3>
          {kpis?.plans.map((p) => (
            <div className="list-row" key={p.tier}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div className="muted" style={{ fontSize: 13 }}>{p.priceKz > 0 ? `${kz(p.priceKz)}/mês` : 'Sob consulta'}</div>
              </div>
              <strong style={{ fontSize: 18 }}>{p.companies}</strong>
            </div>
          ))}
        </div>

        {/* Atividade recente */}
        <div className="card">
          <h3>Empresas recentes</h3>
          {recent.length === 0 ? <p className="muted">Sem registos.</p> : recent.map((c) => (
            <div className="list-row" key={c.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{c.name} <span className="muted" style={{ fontWeight: 500 }}>· {c.code}</span></div>
                <div className="muted" style={{ fontSize: 13 }}>{c.plan?.name ?? '—'} · {formatDate(c.createdAt)}</div>
              </div>
              <StatusBadge status={c.status} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function KpiCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`kpi-card ${tone}`}>
      <div className="kpi-ic">{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
