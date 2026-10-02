import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MyLeave } from '../api/types';
import { UiIcon } from './UiIcon';

const TYPES: { id: MyLeave['type']; label: string; hint: string }[] = [
  { id: 'FERIAS', label: 'Férias', hint: 'Período de descanso' },
  { id: 'FALTA', label: 'Falta', hint: 'Ausência ao trabalho' },
  { id: 'LICENCA', label: 'Licença', hint: 'Licença autorizada' },
  { id: 'OUTRO', label: 'Outro', hint: 'Outro motivo' },
];
const STATUS: Record<MyLeave['status'], { label: string; cls: string }> = {
  PENDING: { label: 'Pendente — a aguardar o gestor', cls: 'warn' },
  APPROVED: { label: 'Aprovado', cls: 'success' },
  REJECTED: { label: 'Rejeitado', cls: 'danger' },
};
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.id, t.label])) as Record<string, string>;
const iso = (d = new Date()) => d.toISOString().slice(0, 10);
const fmt = (s: string) => { try { return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-PT'); } catch { return s; } };

/**
 * Pedido de férias/ausência do operador: liga-se às Férias do RH — o pedido fica
 * PENDENTE, o gestor é notificado (sino do admin) e decide Aceitar/Rejeitar.
 */
export function LeaveRequestModal({ onClose }: { onClose(): void }) {
  const [type, setType] = useState<MyLeave['type']>('FERIAS');
  const [start, setStart] = useState(iso());
  const [end, setEnd] = useState(iso());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<MyLeave[]>([]);
  const [linked, setLinked] = useState(true);

  const load = () => { api.myLeaves().then((r) => { setMine(r.rows); setLinked(r.linked); }).catch(() => undefined); };
  useEffect(() => { load(); }, []);

  const days = useMemo(() => {
    const a = new Date(start + 'T00:00:00').getTime(); const b = new Date(end + 'T00:00:00').getTime();
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : 0;
  }, [start, end]);

  const submit = async () => {
    setErr(null); setMsg(null);
    if (days < 1) { setErr('A data final não pode ser anterior à inicial.'); return; }
    setBusy(true);
    try {
      await api.requestLeave({ type, startDate: start, endDate: end, reason: reason.trim() || undefined });
      setMsg('Pedido enviado! O gestor foi notificado e vai decidir em breve.');
      setReason(''); load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar o pedido.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="consume-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="consume-head">
          <span className="ch-ic" aria-hidden="true"><UiIcon e="clock" size={20} /></span>
          <div className="ch-tx"><h3>Férias e ausências</h3><small>Pedido ao gestor · ligado ao RH</small></div>
          <button className="x" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="consume-body">
          {msg ? <div className="banner success" style={{ marginBottom: 12 }}>{msg}</div> : null}
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
          {!linked ? (
            <div className="banner warn">Ainda não tens uma ficha de funcionário associada em RH. Fala com o gestor para te registar.</div>
          ) : (
            <>
              <label className="adv-label" style={{ marginTop: 0 }}>Tipo de pedido</label>
              <div className="lv-types">
                {TYPES.map((t) => (
                  <button key={t.id} type="button" className={`lv-type-b${type === t.id ? ' on' : ''}`} onClick={() => setType(t.id)}>
                    <b>{t.label}</b><small>{t.hint}</small>
                  </button>
                ))}
              </div>

              <label className="adv-label">Período</label>
              <div className="lv-dates">
                <label>De <input type="date" value={start} min={iso()} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></label>
                <label>Até <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
                <div className="lv-days"><b>{days}</b><span>{days === 1 ? 'dia' : 'dias'}</span></div>
              </div>

              <label className="adv-label">Motivo (opcional)</label>
              <div className="field">
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ex.: viagem, saúde, assuntos familiares…" />
              </div>
            </>
          )}

          {mine.length > 0 ? (
            <div className="consume-mine">
              <div className="erp-sec">Os meus pedidos <span>{mine.length}</span></div>
              {mine.map((a) => {
                const s = STATUS[a.status] ?? { label: a.status, cls: 'muted' };
                return (
                  <div key={a.id} className="adv-hist">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">{TYPE_LABEL[a.type] ?? a.type} · {a.days} {a.days === 1 ? 'dia' : 'dias'}</div>
                      <div className="meta">{fmt(a.start_date)} → {fmt(a.end_date)}{a.reason ? ` · ${a.reason}` : ''}{a.reviewed_by_name ? ` · ${a.reviewed_by_name}` : ''}</div>
                    </div>
                    <span className={`adv-badge ${s.cls}`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {linked ? (
          <div className="consume-foot">
            <p className="muted">O gestor recebe uma notificação e decide Aceitar ou Rejeitar. Vês aqui o resultado.</p>
            <button className="btn lg block" disabled={busy || days < 1} onClick={() => void submit()}>
              {busy ? 'A enviar…' : `Pedir ${days} ${days === 1 ? 'dia' : 'dias'}`}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
