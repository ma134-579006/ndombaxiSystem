import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AdvanceLimit, SalaryAdvance } from '../api/types';
import { formatKz } from '../format';
import { UiIcon } from './UiIcon';

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pendente', cls: 'warn' },
  APPROVED: { label: 'Aprovado — será descontado no salário', cls: 'success' },
  REJECTED: { label: 'Rejeitado', cls: 'danger' },
  DEDUCTED: { label: 'Descontado no salário', cls: 'muted' },
};

const MONTHS = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/**
 * Adiantamento salarial do funcionário (caixa): mostra o limite disponível
 * (salário − adiantamentos por descontar), pede um valor (1 Kz até ao limite) e
 * o gestor aprova/rejeita. O valor aprovado é descontado na folha do mês exato.
 */
export function SalaryAdvanceModal({ onClose }: { onClose(): void }) {
  const [lim, setLim] = useState<AdvanceLimit | null>(null);
  const [mine, setMine] = useState<SalaryAdvance[]>([]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    api.advanceLimit().then(setLim).catch(() => undefined);
    api.myAdvances().then(setMine).catch(() => undefined);
  };
  useEffect(() => { load(); }, []);

  const available = lim?.available ?? 0;
  const value = Number(amount.replace(/[^\d.]/g, '')) || 0;
  const canSubmit = lim?.employeeLinked && value >= 1 && value <= available && !busy;

  const chips = useMemo(() => {
    if (available < 1) return [] as number[];
    const opts = [1000, 5000, 10000, 25000, 50000].filter((v) => v <= available);
    if (!opts.includes(available)) opts.push(Math.round(available));
    return Array.from(new Set(opts)).slice(0, 6);
  }, [available]);

  const submit = async () => {
    setErr(null); setMsg(null);
    if (value < 1) { setErr('Indica um valor a partir de 1 Kz.'); return; }
    if (value > available) { setErr(`O valor excede o limite disponível (${formatKz(available)}).`); return; }
    setBusy(true);
    try {
      await api.requestAdvance(value, reason.trim() || undefined);
      setMsg('Pedido enviado! O gestor vai receber a notificação para aprovar.');
      setAmount(''); setReason('');
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar o pedido.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="consume-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="consume-head">
          <span className="ch-ic" aria-hidden="true"><UiIcon e="money" size={20} /></span>
          <div className="ch-tx"><h3>Adiantamento salarial</h3><small>Pedido ao gestor · descontado na folha do mês</small></div>
          <button className="x" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="consume-body">
          {msg ? <div className="banner success" style={{ marginBottom: 12 }}>{msg}</div> : null}
          {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}

          {lim && !lim.employeeLinked ? (
            <div className="banner warn">Ainda não tens uma ficha de funcionário associada em RH. Fala com o gestor para te registar e definir o salário.</div>
          ) : (
            <>
              {/* Limite: indicadores + barra de utilização */}
              <div className="erp-kpis">
                <div className="erp-kpi"><span>Salário mensal</span><b>{formatKz(lim?.monthlyPay ?? 0)}</b></div>
                <div className="erp-kpi"><span>Por descontar</span><b>{formatKz(lim?.outstanding ?? 0)}</b></div>
                <div className="erp-kpi hi"><span>Disponível</span><b>{formatKz(available)}</b></div>
              </div>
              <div className="erp-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(((lim?.outstanding ?? 0) / Math.max(lim?.monthlyPay ?? 1, 1)) * 100))}%` }} /></div>
              <div className="erp-bar-l">{Math.min(100, Math.round(((lim?.outstanding ?? 0) / Math.max(lim?.monthlyPay ?? 1, 1)) * 100))}% do salário já comprometido</div>

              {/* Formulário */}
              <label className="adv-label">Valor do adiantamento</label>
              <div className="field">
                <span aria-hidden style={{ opacity: .7 }}>Kz</span>
                <input inputMode="numeric" value={amount} autoFocus
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={`1 até ${formatKz(available)}`} />
              </div>
              {chips.length > 0 ? (
                <div className="adv-chips">
                  {chips.map((c) => (
                    <button key={c} type="button" className="adv-chip" onClick={() => setAmount(String(c))}>{formatKz(c)}</button>
                  ))}
                </div>
              ) : null}

              <label className="adv-label">Motivo (opcional)</label>
              <div className="field">
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
                  placeholder="Ex.: imprevisto, saúde, transporte…" />
              </div>

              <button className="btn block" style={{ marginTop: 12 }} disabled={!canSubmit} onClick={() => void submit()}>
                {busy ? 'A enviar…' : 'Pedir adiantamento'}
              </button>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                O pedido fica pendente até o gestor/gerente aprovar. Depois de aprovado, o valor é descontado automaticamente no teu salário do mês do pagamento.
              </p>
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
                      <div className="nm">{formatKz(Number(a.amount))}</div>
                      <div className="meta">
                        {new Date(a.requested_at).toLocaleDateString('pt-PT')}
                        {a.reason ? ` · ${a.reason}` : ''}
                        {a.status === 'DEDUCTED' && a.period_month ? ` · folha ${MONTHS[a.period_month]}/${a.period_year}` : ''}
                        {a.status === 'REJECTED' && a.review_note ? ` · ${a.review_note}` : ''}
                      </div>
                    </div>
                    <span className={`adv-badge ${s.cls}`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
