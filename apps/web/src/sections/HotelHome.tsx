import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { HotelDashboard } from '../api/types';
import { formatKz } from '../format';

const KZ = (n: number) => formatKz(Number(n) || 0);
type HotelTab = 'rooms' | 'reservations' | 'housekeeping' | 'maintenance';

/**
 * CENTRO DE COMANDO do hotel (vertical HOSPITALITY) — mesma engenharia do
 * restaurante: nativo de PMS, não uma grelha de atalhos para o retalho. Lê o
 * dashboard operacional (receção/ocupação, movimentos de hoje, limpeza/
 * manutenção, vendas por canal) e oferece AÇÕES PRÓPRIAS. Refresca sozinho.
 */
export function HotelHome({ onGo }: { onGo(section: string): void }) {
  // Deep-link para o separador certo de "Quartos & Reservas".
  const goHotel = (tab: HotelTab) => {
    try { sessionStorage.setItem('ndx_hotel_tab', tab); } catch { /* indisponível */ }
    onGo('hotel');
  };
  const [d, setD] = useState<HotelDashboard | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.hotel.dashboard()
      .then((r) => { if (alive) { setD(r); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    void load();
    const t = window.setInterval(load, 8000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const opsPending = d ? d.ops.housekeepingPending + d.ops.maintenanceOpen : 0;

  return (
    <>
      <div className="content-head">
        <h2>🏨 Hotelaria — Centro de comando</h2>
        <span className="spacer" />
        <button className="btn primary" onClick={() => goHotel('rooms')}>🛏️ Ver quartos</button>
      </div>

      {err && !d ? (
        <div className="card"><div className="empty"><p>Não foi possível carregar o painel do hotel. Verifica a ligação.</p></div></div>
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
            <Channel icon="🧾" label="Receção & balcão" value={d?.sales ? KZ(d.sales.counter) : '—'} />
            <Channel icon="🛜" label="Reservas online" value={d?.sales ? KZ(d.sales.online) : '—'} />
          </div>
        </div>
      </div>

      {/* ── Receção (agora) ── */}
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Tile label="Ocupação agora" value={d ? `${d.rooms.occupancyPct}%` : '—'} hint={d ? `${d.rooms.occupied}/${d.rooms.total} quartos ocupados` : 'a carregar…'} tone={d && d.rooms.occupancyPct >= 85 ? 'warn' : 'info'} />
        <Tile label="Hóspedes alojados" value={d ? String(d.inHouse.guests) : '—'} hint={d ? `${d.inHouse.reservations} estadia(s) em curso` : ''} />
        <Tile label="Conta em aberto (folio)" value={d ? KZ(d.inHouse.openFolioValue) : '—'} hint="estadias + extras por faturar" />
        <Tile label="Quartos livres" value={d ? String(d.rooms.available) : '—'} hint={d ? `${d.rooms.cleaning} em limpeza · ${d.rooms.maintenance} manutenção` : ''} tone={d && d.rooms.available === 0 ? 'warn' : undefined} />
      </div>

      {/* ── Limpeza / manutenção pendentes ── */}
      {d && opsPending > 0 ? (
        <div className="card" style={{ marginBottom: 14, borderLeft: `4px solid ${d.ops.maintenanceOpen > 0 ? 'var(--warning)' : 'var(--primary)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 30 }}>🧹</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>Governanta & manutenção</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {d.ops.housekeepingPending > 0 ? <><strong>{d.ops.housekeepingPending}</strong> quarto(s) por limpar. </> : null}
                {d.ops.maintenanceOpen > 0 ? <><strong style={{ color: 'var(--warning)' }}>{d.ops.maintenanceOpen}</strong> avaria(s) em aberto.</> : null}
              </div>
            </div>
            <button className="btn ghost" onClick={() => goHotel('housekeeping')}>Ver limpeza</button>
            <button className="btn ghost" onClick={() => goHotel('maintenance')}>Ver manutenção</button>
          </div>
        </div>
      ) : null}

      {/* ── Movimentos de HOJE: chegadas e saídas ── */}
      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 14 }}>
        <MoveList
          title="🛬 Chegadas de hoje"
          empty="Sem chegadas previstas para hoje."
          count={d?.today.arrivals.length ?? 0}
          rows={(d?.today.arrivals ?? []).map((a) => ({ id: a.id, left: a.guest, mid: `${a.room} · ${a.nights} noite(s)`, right: a.number }))}
          onOpen={() => goHotel('reservations')}
          badge={d && d.today.pendingOnline > 0 ? `${d.today.pendingOnline} online` : undefined}
        />
        <MoveList
          title="🛫 Saídas de hoje"
          empty="Sem saídas previstas para hoje."
          count={d?.today.departures.length ?? 0}
          rows={(d?.today.departures ?? []).map((x) => ({ id: x.id, left: x.guest, mid: x.room, right: KZ(x.total) }))}
          onOpen={() => goHotel('reservations')}
        />
      </div>

      {/* ── Ações próprias do hotel ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }}>Operação</h3>
      <div className="pgrid">
        <ActionCard icon="🛏️" title="Quartos" desc="Mapa de quartos, estados e tarifas." onClick={() => goHotel('rooms')} />
        <ActionCard icon="📅" title="Reservas & check-in/out" desc="Reservar, dar entrada/saída, folio e fatura." onClick={() => goHotel('reservations')} badge={d && d.today.pendingOnline > 0 ? String(d.today.pendingOnline) : undefined} />
        <ActionCard icon="🧹" title="Limpeza (governanta)" desc="Quartos por limpar após saída." onClick={() => goHotel('housekeeping')} badge={d && d.ops.housekeepingPending > 0 ? String(d.ops.housekeepingPending) : undefined} />
        <ActionCard icon="🔧" title="Manutenção" desc="Avarias por quarto (AC, chuveiro, TV…)." onClick={() => goHotel('maintenance')} badge={d && d.ops.maintenanceOpen > 0 ? String(d.ops.maintenanceOpen) : undefined} />
      </div>

      {/* ── Estado dos quartos ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }}>Quartos</h3>
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Tile label="Livres" value={d ? String(d.rooms.available) : '—'} tone="info" />
        <Tile label="Ocupados" value={d ? String(d.rooms.occupied) : '—'} />
        <Tile label="Em limpeza" value={d ? String(d.rooms.cleaning) : '—'} />
        <Tile label="Manutenção" value={d ? String(d.rooms.maintenance) : '—'} tone={d && d.rooms.maintenance > 0 ? 'warn' : undefined} />
        <Tile label="Bloqueados" value={d ? String(d.rooms.blocked) : '—'} />
      </div>

      {/* ── Gestão (secundário: partilhado com o núcleo) ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }} className="muted">Gestão</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => onGo('operations')}>🧾 Caixa & Faturação</button>
        <button className="btn ghost" onClick={() => onGo('reports')}>📊 Relatórios & SAF-T</button>
        <button className="btn ghost" onClick={() => onGo('employees')}>👥 Equipa & Folha</button>
        <button className="btn ghost" onClick={() => onGo('customers')}>🤝 Hóspedes</button>
      </div>
    </>
  );
}

function MoveList({ title, empty, count, rows, onOpen, badge }: {
  title: string; empty: string; count: number;
  rows: { id: string; left: string; mid: string; right: string }[];
  onOpen(): void; badge?: string;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #0002)' }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span className="pill on">{count}</span>
        {badge ? <span className="pill" style={{ background: 'var(--warning)', color: '#111' }}>{badge}</span> : null}
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={onOpen}>Abrir</button>
      </div>
      {rows.length === 0 ? (
        <div className="empty" style={{ padding: 18 }}><p className="muted" style={{ fontSize: 13 }}>{empty}</p></div>
      ) : rows.slice(0, 6).map((r) => (
        <div key={r.id} className="list-row" style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.left}</div>
            <div className="muted" style={{ fontSize: 12 }}>{r.mid}</div>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{r.right}</span>
        </div>
      ))}
    </div>
  );
}

function Channel({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="muted" style={{ fontSize: 11.5 }}>{icon} {label}</div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'info' | 'warn' }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="muted" style={{ fontSize: 12.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, margin: '2px 0', color: tone === 'warn' ? 'var(--warning)' : tone === 'info' ? 'var(--primary)' : 'var(--text)' }}>{value}</div>
      {hint ? <div className="muted" style={{ fontSize: 11.5 }}>{hint}</div> : null}
    </div>
  );
}

function ActionCard({ icon, title, desc, onClick, badge }: { icon: string; title: string; desc: string; onClick(): void; badge?: string }) {
  return (
    <button className="pcard" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', position: 'relative' }}>
      <div className="thumb" style={{ fontSize: 30, display: 'grid', placeItems: 'center' }}>{icon}</div>
      <div className="pinfo">
        <div className="pname">{title}</div>
        <div className="pcode">{desc}</div>
        <div className="pfoot"><span className="pill on">Abrir</span></div>
      </div>
      {badge ? <span className="pill" style={{ position: 'absolute', top: 10, right: 10, background: 'var(--warning)', color: '#111' }}>{badge}</span> : null}
    </button>
  );
}
