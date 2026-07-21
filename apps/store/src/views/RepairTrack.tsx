import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { RepairStatus } from '../api/types';
import { IconStore } from '../components/Icons';

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Recebida', QUOTED: 'Orçamentada', APPROVED: 'Aprovada',
  IN_PROGRESS: 'Em reparação', READY: 'Pronto para levantar', DELIVERED: 'Entregue', CANCELLED: 'Cancelada',
};
/** Índice do estado no funil (para a linha do tempo). */
const STATUS_STEP: Record<string, number> = { OPEN: 0, QUOTED: 0, APPROVED: 1, IN_PROGRESS: 2, READY: 3, DELIVERED: 4 };
const STEPS = ['Recebido', 'Orçamento aprovado', 'Em reparação', 'Pronto', 'Entregue'];

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }) : null);

/**
 * PORTAL DO CLIENTE — página pública de rastreio do reparo, aberta pelo QR da
 * folha de serviço/obra. Mostra só informação segura (estado, equipamento,
 * linha do tempo, garantia) — nunca IMEI, desbloqueio ou dados pessoais.
 */
export function RepairTrack({ code, token }: { code: string; token: string }) {
  const [data, setData] = useState<RepairStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => api.repairStatus(code, token)
      .then((d) => { if (alive) { setData(d); setErr(null); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Ordem não encontrada.'); })
      .finally(() => { if (alive) setLoading(false); });
    void load();
    // Atualiza sozinho a cada 30 s — o cliente vê o estado evoluir em tempo real.
    const t = window.setInterval(load, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, [code, token]);

  if (loading) return <div className="gate"><p className="muted">A abrir o estado do reparo…</p></div>;
  if (err || !data) {
    return (
      <div className="gate"><div className="card">
        <div className="logo"><IconStore size={32} /></div>
        <h2 style={{ margin: '0 0 6px' }}>Reparo não encontrado</h2>
        <div className="banner danger" style={{ marginBottom: 8 }}>{err || 'Verifique o link/QR da sua folha de serviço.'}</div>
      </div></div>
    );
  }

  const cancelled = data.status === 'CANCELLED';
  const step = STATUS_STEP[data.status] ?? 0;
  const dates: (string | null)[] = [data.receivedAt || data.createdAt, data.quoteApprovedAt, data.workStartedAt, null, data.deliveredAt];

  return (
    <div className="gate" style={{ alignItems: 'flex-start', paddingTop: 24 }}>
      <div className="card" style={{ maxWidth: 460, width: '100%' }}>
        <div className="logo"><IconStore size={30} /></div>
        <h2 style={{ margin: '2px 0 2px' }}>Estado do seu reparo</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{data.number}{data.equipment ? ` · ${data.equipment}` : ''}</p>

        {/* Estado atual em destaque */}
        <div className="banner" style={{ background: cancelled ? '#fee2e2' : 'var(--accent, #2563eb)', color: cancelled ? '#991b1b' : '#fff', borderRadius: 12, padding: '12px 14px', margin: '10px 0 16px', fontWeight: 800, fontSize: 16, textAlign: 'center' }}>
          {STATUS_LABEL[data.status] ?? data.status}
        </div>

        {/* Linha do tempo */}
        {!cancelled ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: '4px 0 16px' }}>
            {STEPS.map((label, i) => {
              const done = i < step;
              const current = i === step;
              const on = done || current;
              return (
                <div key={label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none',
                      background: on ? (current ? 'var(--accent, #2563eb)' : '#16a34a') : '#e5e7eb',
                      color: on ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: 800 }}>
                      {done ? '✓' : current ? '•' : i + 1}
                    </div>
                    {i < STEPS.length - 1 ? <div style={{ width: 2, height: 26, background: i < step ? '#16a34a' : '#e5e7eb' }} /> : null}
                  </div>
                  <div style={{ paddingBottom: 14 }}>
                    <div style={{ fontWeight: on ? 700 : 500, color: on ? 'var(--text, #0f172a)' : '#9ca3af', fontSize: 14 }}>{label}</div>
                    {dates[i] ? <div className="muted" style={{ fontSize: 12 }}>{fmtDate(dates[i])}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {data.problem ? (
          <div style={{ margin: '2px 0 12px' }}>
            <div className="muted" style={{ fontSize: 12 }}>Serviço pedido</div>
            <div style={{ fontSize: 13.5 }}>{data.problem}</div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
          {data.technician ? <div><span className="muted">Técnico:</span> <strong>{data.technician}</strong></div> : null}
          {data.total > 0 ? <div><span className="muted">Total:</span> <strong>{data.total.toLocaleString('pt-PT')} Kz</strong></div> : null}
          {data.warrantyDays && data.warrantyUntil ? <div><span className="muted">Garantia até:</span> <strong>{new Date(data.warrantyUntil).toLocaleDateString('pt-PT')}</strong></div> : null}
        </div>

        <p className="muted" style={{ fontSize: 11.5, marginTop: 16, marginBottom: 0, textAlign: 'center' }}>Esta página atualiza-se automaticamente.</p>
      </div>
    </div>
  );
}
