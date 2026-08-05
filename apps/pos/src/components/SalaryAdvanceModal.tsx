import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Dialog, type Tone } from '@nexus/ui';
import { api, ApiError } from '../api/client';
import type { AdvanceLimit, SalaryAdvance } from '../api/types';
import { formatKz } from '../format';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendente', tone: 'warning' },
  APPROVED: { label: 'Aprovado — será descontado no salário', tone: 'success' },
  REJECTED: { label: 'Rejeitado', tone: 'danger' },
  DEDUCTED: { label: 'Descontado no salário', tone: 'neutral' },
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
    <Dialog open onClose={onClose} title="💸 Adiantamento salário" size="sm">
      {/* Sucesso e erro anunciados: o funcionário fica a saber que o pedido
          saiu sem ter de procurar a faixa verde no meio do formulário. */}
      {msg ? <div className="banner success" role="status">{msg}</div> : null}
      {err ? <div className="banner danger" role="alert">{err}</div> : null}

      {lim && !lim.employeeLinked ? (
        <div className="banner warn">
          Ainda não tens uma ficha de funcionário associada em RH. Fala com o gestor para te registar e definir o
          salário.
        </div>
      ) : (
        <>
          {/* Cartão do limite */}
          <div className="adv-card">
            <div className="adv-row"><span>Salário mensal</span><strong className="nx-num">{formatKz(lim?.monthlyPay ?? 0)}</strong></div>
            {(lim?.outstanding ?? 0) > 0 ? (
              <div className="adv-row"><span>Já por descontar</span><strong className="nx-num">− {formatKz(lim?.outstanding ?? 0)}</strong></div>
            ) : null}
            <div className="adv-row big"><span>Disponível para pedir</span><strong className="nx-num">{formatKz(available)}</strong></div>
          </div>

          {/* Formulário */}
          <label className="adv-label" htmlFor="adv-amount">Valor do adiantamento</label>
          <div className="field">
            <span aria-hidden style={{ opacity: .7 }}>Kz</span>
            {/* `autoFocus` mantém-se: o limite chega da API DEPOIS de o diálogo
                abrir, por isso o campo ainda não existe quando o Dialog procura
                o primeiro controlo. Sem isto, o foco ficaria no painel. */}
            <input id="adv-amount" inputMode="numeric" value={amount} autoFocus
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={`1 até ${formatKz(available)}`} />
          </div>
          {chips.length > 0 ? (
            <div className="adv-chips" role="group" aria-label="Valores sugeridos">
              {chips.map((c) => (
                <button key={c} type="button" className="adv-chip" onClick={() => setAmount(String(c))}>{formatKz(c)}</button>
              ))}
            </div>
          ) : null}

          <label className="adv-label" htmlFor="adv-reason">Motivo (opcional)</label>
          <div className="field">
            <input id="adv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
              placeholder="Ex.: imprevisto, saúde, transporte…" />
          </div>

          <Button variant="primary" block loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? 'A enviar…' : 'Pedir adiantamento'}
          </Button>
          <p className="nx-caption" style={{ margin: 0 }}>
            O pedido fica pendente até o gestor/gerente aprovar. Depois de aprovado, o valor é descontado
            automaticamente no teu salário do mês do pagamento.
          </p>
        </>
      )}

      {mine.length > 0 ? (
        <div className="consume-mine">
          <strong className="nx-body-sm" style={{ display: 'block', marginBottom: 8 }}>Os meus pedidos</strong>
          {mine.map((a) => {
            const s = STATUS[a.status] ?? { label: a.status, tone: 'neutral' as Tone };
            return (
              <div key={a.id} className="adv-hist">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nm nx-num">{formatKz(Number(a.amount))}</div>
                  <div className="meta">
                    {new Date(a.requested_at).toLocaleDateString('pt-PT')}
                    {a.reason ? ` · ${a.reason}` : ''}
                    {a.status === 'DEDUCTED' && a.period_month ? ` · folha ${MONTHS[a.period_month]}/${a.period_year}` : ''}
                    {a.status === 'REJECTED' && a.review_note ? ` · ${a.review_note}` : ''}
                  </div>
                </div>
                <Badge dot tone={s.tone}>{s.label}</Badge>
              </div>
            );
          })}
        </div>
      ) : null}
    </Dialog>
  );
}
