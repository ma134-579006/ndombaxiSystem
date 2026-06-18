import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AuditEvent, CashSessionRow } from '../api/types';
import { IconCheck, IconClose } from '../components/Icons';

function kz(v: string | number | null): string {
  if (v == null) return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n.toLocaleString('pt-PT', { minimumFractionDigits: 2 }) + ' Kz' : '—';
}

const ACTION_LABEL: Record<string, string> = {
  SALE_EMITTED: 'Venda emitida',
  SALE_CANCELLED: 'Venda anulada',
  SHIFT_OPEN: 'Abertura de turno',
  SHIFT_CLOSE: 'Fecho de turno',
  CASH_IN: 'Reforço de caixa',
  CASH_OUT: 'Sangria de caixa',
  STOCK_IN: 'Entrada de stock',
  STOCK_WRITE_OFF: 'Baixa de stock',
  INVENTORY_OPEN: 'Inventário iniciado',
  INVENTORY_CLOSE: 'Inventário fechado',
};

/** Caixa (turnos) + Auditoria do gerente, com abas. */
export function Operations() {
  const [tab, setTab] = useState<'shifts' | 'audit'>('shifts');
  return (
    <>
      <div className="content-head">
        <h2>Caixa & Auditoria</h2>
        <span className="spacer" />
        <div className="seg" style={{ maxWidth: 320 }}>
          <button className={tab === 'shifts' ? 'on' : ''} onClick={() => setTab('shifts')}>Turnos</button>
          <button className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>Auditoria</button>
        </div>
      </div>
      {tab === 'shifts' ? <Shifts /> : <Audit />}
    </>
  );
}

function Shifts() {
  const [rows, setRows] = useState<CashSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.cashbox.sessions().then(setRows).catch((e) => setError(e instanceof ApiError ? e.message : 'Falha.')).finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h3>Histórico de turnos</h3>
      {error ? <div className="banner danger">{error}</div> : null}
      {loading ? <div className="loading">A carregar…</div> : rows.length === 0 ? (
        <p className="muted">Ainda não há turnos registados.</p>
      ) : rows.map((s) => {
        const diff = s.difference == null ? null : Number(s.difference);
        const tone = diff == null ? 'var(--muted)' : diff === 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--warning)';
        return (
          <div className="list-row" key={s.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>
                {s.opened_by_name ?? '—'}
                {s.status === 'OPEN' ? <span className="badge" style={{ marginLeft: 8, color: 'var(--success)', borderColor: 'var(--success)' }}>Aberto</span> : null}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {new Date(s.opened_at).toLocaleString('pt-PT')}
                {s.closed_at ? ` → ${new Date(s.closed_at).toLocaleString('pt-PT')}` : ''} ·{' '}
                {s.sales_count} vendas · {kz(s.total_sales)}
              </div>
            </div>
            {s.status === 'CLOSED' ? (
              <div style={{ textAlign: 'right' }}>
                <div className="muted" style={{ fontSize: 12 }}>Contado {kz(s.counted_cash)} / esperado {kz(s.expected_cash)}</div>
                <div style={{ fontWeight: 800, color: tone }}>
                  {diff === 0 ? 'Caixa certo' : diff != null && diff < 0 ? `Quebra ${kz(Math.abs(diff))}` : `Sobra ${kz(diff)}`}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [integrity, setIntegrity] = useState<{ valid: boolean; brokenAtSeq: number | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.audit.list(filter || undefined)); } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const [repairing, setRepairing] = useState(false);
  const verify = async () => {
    try { setIntegrity(await api.audit.verify()); } catch { /* sem permissão */ }
  };
  const repair = async () => {
    setRepairing(true);
    try { await api.audit.reseal(); setIntegrity(await api.audit.verify()); }
    catch { /* sem permissão */ }
    finally { setRepairing(false); }
  };

  const FILTERS = ['', 'SALE_EMITTED', 'SALE_CANCELLED', 'SHIFT_OPEN', 'SHIFT_CLOSE', 'STOCK_IN', 'STOCK_WRITE_OFF'];

  return (
    <>
      <div className="card" style={{ padding: '12px 14px' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f || 'all'} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f ? ACTION_LABEL[f] ?? f : 'Tudo'}
            </button>
          ))}
          <span className="spacer" />
          <button className="btn sm ghost" onClick={verify}>Verificar integridade</button>
        </div>
        {integrity ? (
          <div className={`banner ${integrity.valid ? 'success' : 'danger'}`} style={{ marginTop: 10, alignItems: 'center' }}>
            {integrity.valid ? (
              <><IconCheck size={16} /> Cadeia de auditoria íntegra — nada foi alterado.</>
            ) : (
              <>
                <IconClose size={16} />
                <span style={{ flex: 1 }}>Cadeia partida no registo #{integrity.brokenAtSeq}. Pode ser de registos antigos — toca em "Reparar" para voltar a selar.</span>
                <button className="btn sm" onClick={repair} disabled={repairing}>{repairing ? 'A reparar…' : 'Reparar'}</button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>Registo de auditoria</h3>
        {loading ? <div className="loading">A carregar…</div> : rows.length === 0 ? (
          <p className="muted">Sem eventos.</p>
        ) : rows.map((e) => (
          <div className="list-row" key={e.seq}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{ACTION_LABEL[e.action] ?? e.action}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {e.actor_name ?? 'sistema'} · {new Date(e.timestamp).toLocaleString('pt-PT')}
                {renderDetails(e.details)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function renderDetails(d: Record<string, unknown> | null): string {
  if (!d) return '';
  const bits: string[] = [];
  if (d.number) bits.push(String(d.number));
  if (d.grossTotal != null) bits.push(`${Number(d.grossTotal).toLocaleString('pt-PT')} Kz`);
  if (d.creditNote) bits.push(`NC ${d.creditNote}`);
  if (d.reason) bits.push(String(d.reason));
  if (d.verdict) bits.push(String(d.verdict));
  if (d.quantity != null) bits.push(`qt ${d.quantity}`);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}
