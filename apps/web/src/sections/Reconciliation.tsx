import React, { useCallback, useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type { BankTx, ImportStatementRow, ReconSummary } from '../api/types';
import { IconCard, IconRefresh } from '../components/Icons';
import { formatKz } from '../format';

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'unmatched', label: 'Por conciliar' },
  { key: 'matched', label: 'Conciliados' },
];

const TYPE_LABEL: Record<string, string> = {
  SALE: 'Venda', RECEIVABLE: 'Recebimento', EXPENSE: 'Gasto', PAYABLE: 'Pagamento', MANUAL: 'Manual',
};

/** Normaliza data para YYYY-MM-DD (aceita YYYY-MM-DD ou DD/MM/AAAA). */
function normDate(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
/** Converte valor monetário em número (aceita "1.234,56", "1234.56", "-50"). */
function parseAmount(s: string): number | null {
  let v = s.replace(/[^\d.,-]/g, '').trim();
  if (!v || v === '-' || /^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (v.includes('.') && v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  else if (v.includes(',')) v = v.replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseCsv(text: string): ImportStatementRow[] {
  const out: ImportStatementRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const delim = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
    const parts = line.split(delim).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    let date = ''; let amount: number | null = null; const desc: string[] = [];
    for (const p of parts) {
      const d = normDate(p);
      if (!date && d) { date = d; continue; }
      const n = parseAmount(p);
      if (amount === null && n !== null) { amount = n; continue; }
      desc.push(p);
    }
    if (date && amount !== null && amount !== 0) out.push({ date, description: desc.join(' ') || undefined, amount });
  }
  return out;
}

/** Conciliação bancária: importa extrato (CSV) e cruza com vendas/gastos. */
export function Reconciliation() {
  const [filter, setFilter] = useState('unmatched');
  const [rows, setRows] = useState<BankTx[]>([]);
  const [sum, setSum] = useState<ReconSummary | null>(null);
  const [parsed, setParsed] = useState<ImportStatementRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([api.reconciliation.list(filter), api.reconciliation.summary()]);
      setRows(l); setSum(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar a conciliação.');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setMsg(null); setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const r = parseCsv(String(reader.result));
      if (r.length === 0) { setError('Não encontrei movimentos no ficheiro. Formato: data;descrição;valor'); setParsed(null); return; }
      setParsed(r);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true); setError(null);
    try {
      const r = await api.reconciliation.importStatement(parsed);
      setMsg(`${r.imported} movimento(s) importado(s) · ${r.matched} auto-conciliado(s).`);
      setParsed(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao importar.');
    } finally { setBusy(false); }
  };

  const toggle = async (t: BankTx) => {
    setBusy(true);
    try {
      if (t.matched) await api.reconciliation.unmatch(t.id);
      else await api.reconciliation.match(t.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Operação falhou.');
    } finally { setBusy(false); }
  };

  return (
    <div className="profit-page">
      <div className="content-head no-print">
        <h2>Conciliação bancária</h2>
        <span className="spacer" />
        <label className="btn sm" style={{ cursor: 'pointer' }}>
          Carregar extrato (CSV)
          <input type="file" accept=".csv,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
        <button className="btn sm" onClick={() => void printSectionReport()}>🖨 Imprimir</button>
      </div>

      <div className="banner info no-print" style={{ marginBottom: 12 }}>
        Carregue o extrato do banco em CSV (colunas: <strong>data ; descrição ; valor</strong>; crédito positivo, débito negativo). O sistema cruza automaticamente com vendas, recebimentos, gastos e pagamentos do mesmo valor e data.
      </div>

      {parsed ? (
        <div className="card no-print" style={{ borderColor: 'var(--primary)' }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <strong>{parsed.length}</strong>&nbsp;movimento(s) detetado(s) no ficheiro.
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setParsed(null)} disabled={busy}>Cancelar</button>
            <button className="btn sm" onClick={doImport} disabled={busy}>{busy ? 'A importar…' : 'Importar e conciliar'}</button>
          </div>
        </div>
      ) : null}

      {msg ? <div className="banner success no-print">{msg}</div> : null}
      {error ? <div className="banner danger no-print">{error}</div> : null}

      <div className="print-only print-header"><h2>Conciliação bancária</h2><p>{new Date().toLocaleDateString('pt-PT')}</p></div>

      <div className="kpi-grid">
        <div className="kpi-card success"><div className="kpi-ic"><IconCard size={20} /></div>
          <div className="kpi-label">Créditos (entradas)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(sum?.credits ?? 0)}</div>
          <div className="kpi-sub">{sum?.matchedCount ?? 0} conciliado(s)</div>
        </div>
        <div className="kpi-card danger"><div className="kpi-ic"><IconCard size={20} /></div>
          <div className="kpi-label">Débitos (saídas)</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{formatKz(sum?.debits ?? 0)}</div>
          <div className="kpi-sub">{sum?.unmatchedCount ?? 0} por conciliar</div>
        </div>
      </div>

      <div className="card no-print" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? <div className="loading">A carregar…</div>
          : rows.length === 0 ? <div className="empty"><IconCard size={40} /><p>Sem movimentos. Carregue um extrato CSV.</p></div>
          : (
            <table className="ptable stack">
              <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Estado</th><th className="no-print" /></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const amt = Number(t.amount);
                  return (
                    <tr key={t.id}>
                      <td data-label="Data">{new Date(t.statement_date).toLocaleDateString('pt-PT')}</td>
                      <td data-label="Descrição">{t.description || '—'}</td>
                      <td data-label="Valor" style={{ fontWeight: 700, color: amt >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatKz(amt)}</td>
                      <td data-label="Estado">
                        {t.matched
                          ? <span className="pill on">{t.matched_type ? (TYPE_LABEL[t.matched_type] ?? t.matched_type) : 'Conciliado'}</span>
                          : <span className="pill off">Por conciliar</span>}
                      </td>
                      <td className="actions no-print">
                        <button className="btn sm ghost" disabled={busy} onClick={() => toggle(t)}>
                          {t.matched ? 'Desfazer' : 'Conciliar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
