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
  PRODUCTION: 'Fornada produzida',
  RESTAURANT_ORDER_CANCELLED: 'Comanda cancelada',
};

/** Caixa (turnos) + Auditoria do gerente, com abas. */
export function Operations() {
  const [tab, setTab] = useState<'shifts' | 'audit'>('shifts');
  return (
    <>
      <div className="content-head">
        <h2>Caixa & Auditoria</h2>
      </div>
      <div className="fx-tabs inv-tabs">
        <button className={tab === 'shifts' ? 'on' : ''} onClick={() => setTab('shifts')}>Turnos de caixa</button>
        <button className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>Auditoria</button>
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

  const open = rows.filter((r) => r.status === 'OPEN').length;
  const sales = rows.reduce((t, r) => t + (Number(r.total_sales) || 0), 0);
  const diff = rows.filter((r) => r.status === 'CLOSED').reduce((t, r) => t + (Number(r.difference) || 0), 0);
  return (
    <>
      <div className="fx-stats">
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Turnos</div><div className="vl">{rows.length}</div><div className="sb">{open} aberto(s)</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Vendas nos turnos</div><div className="vl">{kz(sales)}</div><div className="sb">soma dos turnos listados</div></div></div>
        <div className="fx-stat"><span className="ic"><IconCheck size={20} /></span><div><div className="lb">Diferença de caixa</div><div className="vl"><span className={`fx-dot ${diff === 0 ? 'ok' : 'bad'}`} />{kz(diff)}</div><div className="sb">sobras e quebras acumuladas</div></div></div>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}
      {loading ? <div className="card"><div className="loading">A carregar…</div></div> : rows.length === 0 ? (
        <div className="card"><div className="empty"><p>Ainda não há turnos registados.</p></div></div>
      ) : (
        <div className="rc-list">
          {rows.map((s) => {
            const d = s.difference == null ? null : Number(s.difference);
            const isOpen = s.status === 'OPEN';
            return (
              <div className={`rc-row rc-static sh-row st-${isOpen ? 'IN_PROGRESS' : d === 0 ? 'READY' : d != null && d < 0 ? 'CANCELLED' : 'APPROVED'}`} key={s.id}>
                <span className="rc-av">{(s.opened_by_name ?? '?').slice(0, 2).toUpperCase()}</span>
                <div className="rc-main">
                  <strong>{s.opened_by_name ?? '—'}{isOpen ? <span className="lv-type">Aberto agora</span> : null}</strong>
                  <div className="muted">
                    {new Date(s.opened_at).toLocaleString('pt-PT')}{s.closed_at ? ` → ${new Date(s.closed_at).toLocaleString('pt-PT')}` : ''}
                  </div>
                </div>
                <span className="rc-amt">{kz(s.total_sales)}<small>{s.sales_count} venda(s)</small></span>
                {!isOpen ? (
                  <span className="rc-state">{d === 0 ? 'Caixa certo' : d != null && d < 0 ? `Quebra ${kz(Math.abs(d))}` : `Sobra ${kz(d)}`}</span>
                ) : <span />}
                <span className="sh-cash">{!isOpen ? <>Contado {kz(s.counted_cash)}<br />Esperado {kz(s.expected_cash)}</> : null}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
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
      <div className="card toolbar-sticky au-bar">
        <div className="au-chips">
          {FILTERS.map((f) => (
            <button key={f || 'all'} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f ? ACTION_LABEL[f] ?? f : 'Tudo'}
            </button>
          ))}
        </div>
        <button className="btn sm ghost" onClick={verify}>Verificar integridade</button>
      </div>
      {integrity ? (
        <div className={`banner ${integrity.valid ? 'success' : 'danger'}`} style={{ alignItems: 'center' }}>
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

      {loading ? <div className="card"><div className="loading">A carregar…</div></div> : rows.length === 0 ? (
        <div className="card"><div className="empty"><p>Sem eventos.</p></div></div>
      ) : (
        <div className="au-list">
          {rows.map((e) => (
            <div className={`au-row au-${/CANCEL|WRITE_OFF/.test(e.action) ? 'bad' : /SALE|CLOSE/.test(e.action) ? 'ok' : 'info'}`} key={e.seq}>
              <i className="au-dot" />
              <div className="au-main">
                <strong>{ACTION_LABEL[e.action] ?? e.action}</strong>
                <span>{e.actor_name ?? 'sistema'}{renderDetails(e.details)}</span>
              </div>
              <time>{new Date(e.timestamp).toLocaleString('pt-PT')}</time>
            </div>
          ))}
        </div>
      )}
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
