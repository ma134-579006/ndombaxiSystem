import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { RestaurantDashboard } from '../api/types';
import { formatKz } from '../format';

const KZ = (n: number) => formatKz(Number(n) || 0);

/**
 * CENTRO DE COMANDO do restaurante (vertical RESTAURANT) — reconstrução da
 * experiência: nativo de restauração, não uma grelha de atalhos para o retalho.
 * Lê o dashboard operacional (serviço de sala, pressão da cozinha, alertas de
 * cardápio, contas de hoje) e oferece AÇÕES PRÓPRIAS do setor. Refresca sozinho
 * para funcionar como um painel de parede na gerência/passe.
 */
export function RestaurantHome({ onGo }: { onGo(section: string): void }) {
  const [d, setD] = useState<RestaurantDashboard | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.restaurant.dashboard()
      .then((r) => { if (alive) { setD(r); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    void load();
    const t = window.setInterval(load, 8000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const kitchenTone = d ? (d.kitchen.oldestWaitMin >= 15 ? 'crit' : d.kitchen.queue > 0 ? 'warn' : 'ok') : 'ok';

  return (
    <>
      <div className="content-head">
        <h2>🍔 Restauração — Centro de comando</h2>
        <span className="spacer" />
        <button className="btn primary" onClick={() => onGo('restaurant')}>🍽️ Abrir mesas</button>
      </div>

      {err && !d ? (
        <div className="card"><div className="empty"><p>Não foi possível carregar o painel do restaurante. Verifica a ligação.</p></div></div>
      ) : null}

      {/* ── Vendas de HOJE (todos os canais) — a receita real do dia ── */}
      <div className="card" style={{ marginBottom: 14, background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Vendas de hoje · todos os canais</div>
            <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>{d?.sales ? KZ(d.sales.total) : '—'}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{d?.sales ? `${d.sales.invoices} factura(s) emitida(s)` : 'a carregar…'}</div>
          </div>
          <span className="spacer" style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <Channel icon="🧾" label="Balcão & mesa" value={d?.sales ? KZ(d.sales.counter) : '—'} />
            <Channel icon="🛵" label="Loja online" value={d?.sales ? KZ(d.sales.online) : '—'} />
          </div>
        </div>
      </div>

      {/* ── Serviço de sala (agora) ── */}
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Tile label="Sala (ocupação)" value={d ? `${d.service.occupancyPct}%` : '—'} hint={d ? `${d.service.tablesOpen}/${d.service.tablesTotal} mesas ocupadas` : 'a carregar…'} tone={d && d.service.occupancyPct >= 85 ? 'warn' : 'info'} />
        <Tile label="Hóspedes à mesa" value={d ? String(d.service.guestsSeated) : '—'} hint="sentados agora" />
        <Tile label="Em aberto" value={d ? KZ(d.service.openValue) : '—'} hint="comandas por fechar" />
        <Tile label="Ticket médio (aberto)" value={d ? KZ(d.service.avgTab) : '—'} hint="por comanda em curso" />
      </div>

      {/* ── Pressão da cozinha ── */}
      <div className="card" style={{ marginBottom: 14, borderLeft: `4px solid ${kitchenTone === 'crit' ? 'var(--danger, #e5484d)' : kitchenTone === 'warn' ? 'var(--warning)' : 'var(--primary)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 34 }}>👨‍🍳</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Cozinha (KDS)</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {d
                ? d.kitchen.queue === 0
                  ? 'Sem itens na fila — cozinha em dia.'
                  : `${d.kitchen.queue} item(ns) na fila · ${d.kitchen.pending} por preparar · ${d.kitchen.preparing} em preparação` +
                    (d.kitchen.oldestWaitMin > 0 ? ` · mais antigo há ${d.kitchen.oldestWaitMin} min` : '')
                : 'a carregar…'}
            </div>
          </div>
          {d && d.kitchen.oldestWaitMin >= 15 ? (
            <span className="pill off" style={{ background: 'var(--danger, #e5484d)', color: '#fff' }}>Atraso na cozinha</span>
          ) : null}
          <button className="btn ghost" onClick={() => onGo('restaurant')}>Abrir cozinha</button>
        </div>
      </div>

      {/* ── Alertas de cardápio (ingredientes) ── */}
      {d && (d.menu.outOfStock > 0 || d.menu.lowStock > 0) ? (
        <div className="card" style={{ marginBottom: 14, borderLeft: `4px solid ${d.menu.outOfStock > 0 ? 'var(--warning)' : 'var(--primary)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 30 }}>🧾</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>Cardápio & ingredientes</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {d.menu.outOfStock > 0 ? <><strong style={{ color: 'var(--warning)' }}>{d.menu.outOfStock}</strong> prato(s) sem ingredientes (não vendáveis). </> : null}
                {d.menu.lowStock > 0 ? <>{d.menu.lowStock} prato(s) com ingredientes a esgotar (≤5 doses).</> : null}
              </div>
            </div>
            <button className="btn ghost" onClick={() => onGo('restaurant')}>Ver fichas técnicas</button>
          </div>
        </div>
      ) : null}

      {/* ── Ações próprias do restaurante ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }}>Operação</h3>
      <div className="pgrid">
        <ActionCard icon="🍽️" title="Mesas & Comandas" desc="Mapa de sala, abrir mesa, lançar pedidos." onClick={() => onGo('restaurant')} />
        <ActionCard icon="👨‍🍳" title="Cozinha (KDS)" desc="Fila em tempo real, marcar pronto/servido." onClick={() => onGo('restaurant')} badge={d && d.kitchen.queue > 0 ? String(d.kitchen.queue) : undefined} />
        <ActionCard icon="📋" title="Fichas técnicas" desc="Receitas, custo real e quebra por prato." onClick={() => onGo('restaurant')} />
        <ActionCard icon="🥖" title="Produção (fornada)" desc="Padaria/pastelaria: produzir para a prateleira." onClick={() => onGo('restaurant')} />
      </div>

      {/* ── Fecho do dia ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }}>Hoje</h3>
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Tile label="Contas fechadas" value={d ? String(d.today.closedCount) : '—'} hint="comandas do dia" />
        <Tile label="Receita (mesas)" value={d ? KZ(d.today.revenue) : '—'} hint="comandas fechadas hoje" />
        <Tile label="Ticket médio hoje" value={d ? KZ(d.today.avgTicket) : '—'} hint="por conta fechada" />
        <Tile label="Pratos no cardápio" value={d ? String(d.menu.dishesWithRecipe) : '—'} hint="com ficha técnica" />
      </div>

      {/* ── Gestão (secundário: partilhado com o núcleo) ── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, letterSpacing: 0.3 }} className="muted">Gestão</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => onGo('operations')}>🧾 Caixa & Faturação</button>
        <button className="btn ghost" onClick={() => onGo('reports')}>📊 Relatórios & SAF-T</button>
        <button className="btn ghost" onClick={() => onGo('employees')}>👥 Equipa & Folha</button>
        <button className="btn ghost" onClick={() => onGo('customers')}>🤝 Clientes</button>
      </div>
    </>
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
