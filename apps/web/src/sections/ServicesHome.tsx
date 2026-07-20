import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ServicesDashboard } from '../api/types';
import { formatKz } from '../format';

const KZ = (n: number) => formatKz(Number(n) || 0);
const MIN_LABEL = (m?: number | null) => (!m ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}` : `${m}min`);

/**
 * CENTRO DE COMANDO dos Serviços (vertical SERVICES) — mesma engenharia do
 * restaurante/hotel/clínica: a OFICINA lidera. Pipeline das ordens de serviço
 * (funil aberto→orçamentada→aprovada→em curso→pronta), pedidos online por
 * aceitar, prontas por entregar (dinheiro parado) e vendas do dia por canal.
 * Auto-refresh 8 s — serve de painel de parede na receção da oficina.
 */
export function ServicesHome({ onGo }: { onGo(section: string): void }) {
  // Deep-link para a aba/filtro certos de "Ordens de serviço".
  const goOrders = (status?: string) => {
    try {
      sessionStorage.setItem('ndx_srv_tab', 'orders');
      if (status) sessionStorage.setItem('ndx_srv_status', status);
    } catch { /* indisponível */ }
    onGo('service-orders');
  };
  const goEquipments = () => {
    try { sessionStorage.setItem('ndx_srv_tab', 'equipments'); } catch { /* indisponível */ }
    onGo('service-orders');
  };
  const goAgenda = () => {
    try { sessionStorage.setItem('ndx_srv_tab', 'agenda'); } catch { /* indisponível */ }
    onGo('service-orders');
  };

  const [d, setD] = useState<ServicesDashboard | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.serviceOrders.dashboard()
      .then((r) => { if (alive) { setD(r); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    void load();
    const t = window.setInterval(load, 8000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const late = d?.oldestInProgress && d.oldestInProgress.days >= 7;

  return (
    <>
      <div className="content-head">
        <h2>🔧 Serviços — Centro de comando</h2>
        <span className="spacer" />
        <button className="btn primary" onClick={() => goOrders()}>🛠️ Abrir ordens de serviço</button>
      </div>

      {err && !d ? (
        <div className="card"><div className="empty"><p>Não foi possível carregar o painel dos serviços. Verifica a ligação.</p></div></div>
      ) : null}

      {/* ── Vendas de HOJE (todos os canais) ── */}
      <div className="card" style={{ marginBottom: 14, background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Vendas de hoje · todos os canais</div>
            <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>{d?.sales ? KZ(d.sales.total) : '—'}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{d?.sales ? `${d.sales.invoices} factura(s) emitida(s)` : 'a carregar…'}</div>
          </div>
          <span className="spacer" style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div><div className="muted" style={{ fontSize: 11.5 }}>🧾 Balcão & oficina</div><strong>{d?.sales ? KZ(d.sales.counter) : '—'}</strong></div>
            <div><div className="muted" style={{ fontSize: 11.5 }}>🛒 Loja online</div><strong>{d?.sales ? KZ(d.sales.online) : '—'}</strong></div>
          </div>
        </div>
      </div>

      {/* ── Alertas operacionais ── */}
      {d && d.onlinePending > 0 ? (
        <div className="banner warning" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => goOrders('OPEN')}>
          🛒 <strong>{d.onlinePending} pedido(s) de serviço da loja online</strong> por aceitar — toca para abrir.
        </div>
      ) : null}
      {late ? (
        <div className="banner danger" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => goOrders('IN_PROGRESS')}>
          ⏰ A OS <strong>{d?.oldestInProgress?.number}</strong> está em curso há <strong>{d?.oldestInProgress?.days} dia(s)</strong> — verifica o atraso.
        </div>
      ) : null}

      {/* ── PIPELINE da oficina (funil) ── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 14 }}>
        <Stage label="🆕 Abertas" s={d?.pipeline.open} onClick={() => goOrders('OPEN')} />
        <Stage label="📋 Orçamentadas" s={d?.pipeline.quoted} onClick={() => goOrders('QUOTED')} />
        <Stage label="👍 Aprovadas" s={d?.pipeline.approved} onClick={() => goOrders('APPROVED')} />
        <Stage label="🔧 Em curso" s={d?.pipeline.inProgress} onClick={() => goOrders('IN_PROGRESS')} tone={late ? 'var(--danger)' : undefined} />
        <Stage label="✅ Prontas" s={d?.pipeline.ready} onClick={() => goOrders('READY')} tone="var(--success)" />
      </div>

      {/* ── KPIs de OFICINA (Mecânica) ── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 14 }}>
        <button className="card kpi" onClick={goAgenda} style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)' }}>
          <div className="muted" style={{ fontSize: 12 }}>📅 Agendados hoje</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{d?.mechanic?.scheduledToday ?? '—'}</div>
        </button>
        <button className="card kpi" onClick={() => goOrders('QUOTED')} style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)' }}>
          <div className="muted" style={{ fontSize: 12 }}>⏳ À espera de aprovação</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{d?.mechanic?.awaitingApproval ?? '—'}</div>
        </button>
        <div className="card kpi" style={{ border: '1px solid var(--border)' }}>
          <div className="muted" style={{ fontSize: 12 }}>⏱ Tempo médio (30d)</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{d?.mechanic ? MIN_LABEL(d.mechanic.avgWorkMinutes) : '—'}</div>
        </div>
      </div>

      {/* ── Prontas por ENTREGAR (dinheiro na prateleira) ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px' }}>✅ Prontas por entregar</h3>
        {!d || d.readyToDeliver.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Nada pronto por entregar — bom trabalho.</p>
        ) : d.readyToDeliver.map((r) => (
          <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-soft, #0001)', fontSize: 13.5, cursor: 'pointer' }}
            onClick={() => goOrders('READY')}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>{r.number}</strong> · {r.customerName || 'Cliente'}{r.equipment ? ` · ${r.equipment}` : ''}
            </span>
            <strong style={{ flex: 'none', marginLeft: 8 }}>{KZ(r.total)}</strong>
          </div>
        ))}
      </div>

      {/* ── Gestão ── */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={goEquipments}>💻 Equipamentos em carteira · {d?.equipments ?? '—'}</button>
        <button className="btn ghost" onClick={() => onGo('customers')}>👥 Clientes</button>
        <button className="btn ghost" onClick={() => onGo('reports')}>📊 Relatórios</button>
      </div>
    </>
  );
}

function Stage({ label, s, onClick, tone }: { label: string; s?: { count: number; value: number }; onClick(): void; tone?: string }) {
  return (
    <button className="kpi-card" onClick={onClick} style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)', borderTop: tone ? `3px solid ${tone}` : undefined }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 22 }}>{s ? s.count : '—'}</div>
      <div className="kpi-sub">{s ? KZ(s.value) : 'a carregar…'}</div>
    </button>
  );
}
