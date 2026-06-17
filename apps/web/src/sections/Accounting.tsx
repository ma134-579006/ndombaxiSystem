import React, { useEffect, useState } from 'react';
import { printSectionReport } from "../pdf/printDoc";
import { api, ApiError } from '../api/client';
import type { ExpenseSummary, ProfitSummary, ReportTaxRow } from '../api/types';
import { formatKz } from '../format';

/**
 * CONTABILIDADE — visão profissional alinhada à lógica fiscal angolana (AGT):
 *   • Demonstração de Resultados do período (PGC-AO simplificado):
 *     proveitos (vendas), CMVMC (custo das mercadorias), gastos operacionais,
 *     resultado bruto/líquido;
 *   • Apuramento de IVA por taxa (mapa fiscal — base, imposto, total);
 *   • Indicadores (margem, ticket médio, documentos);
 *   • impressão A4 profissional (com o logo da empresa — PrintBrand do Shell).
 * O SAF-T mensal continua na secção Fiscal · SAF-T.
 */

function monthRange(offset = 0): { from: string; to: string; label: string } {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last), label: first.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }) };
}

export function Accounting() {
  const [offset, setOffset] = useState(0);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [tax, setTax] = useState<ReportTaxRow[]>([]);
  const [exp, setExp] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = monthRange(offset);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const [p, t, e] = await Promise.all([
          api.profit.summary(range.from, range.to),
          api.reports.taxMap(range.from, range.to),
          api.expenses.summary(range.from, range.to),
        ]);
        if (!alive) return;
        setProfit(p); setTax(t); setExp(e); setError(null);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Falha ao carregar a contabilidade.');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const ivaTotal = tax.reduce((s, r) => s + Number(r.iva || 0), 0);

  return (
    <>
      <div className="content-head">
        <h2>Contabilidade <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>· {range.label}</span></h2>
        <span className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm ghost" onClick={() => setOffset((o) => o - 1)}>← mês anterior</button>
          {offset < 0 ? <button className="btn sm ghost" onClick={() => setOffset((o) => o + 1)}>mês seguinte →</button> : null}
          <button className="btn sm" onClick={() => void printSectionReport()}>🖨️ Imprimir</button>
        </div>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}
      {loading ? <div className="card"><div className="loading">A apurar o período…</div></div> : null}

      {!loading && profit ? (
        <>
          {/* indicadores */}
          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-label">PROVEITOS (VENDAS)</div>
              <div className="kpi-value">{formatKz(profit.salesGross)}</div>
              <div className="kpi-sub">{profit.salesCount} documentos · ticket {formatKz(profit.ticketAvg)}</div></div>
            <div className="kpi-card"><div className="kpi-label">RESULTADO BRUTO</div>
              <div className="kpi-value">{formatKz(profit.grossProfit)}</div>
              <div className="kpi-sub">margem {profit.marginPct.toFixed(1)}%</div></div>
            <div className={`kpi-card ${profit.netProfit < 0 ? 'danger' : 'success'}`}><div className="kpi-label">RESULTADO LÍQUIDO</div>
              <div className="kpi-value" style={{ color: profit.netProfit < 0 ? 'var(--danger)' : 'var(--success)' }}>{formatKz(profit.netProfit)}</div>
              <div className="kpi-sub">após gastos operacionais</div></div>
            <div className="kpi-card"><div className="kpi-label">IVA APURADO (A ENTREGAR)</div>
              <div className="kpi-value">{formatKz(ivaTotal)}</div>
              <div className="kpi-sub">liquidado nas vendas do mês</div></div>
          </div>

          {/* Demonstração de Resultados (PGC-AO simplificado) */}
          <div className="card">
            <h3>Demonstração de Resultados — {range.label}</h3>
            <table className="ptable stack">
              <thead><tr><th>Rubrica</th><th>Conta (PGC-AO)</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
              <tbody>
                <tr><td data-label="Rubrica"><strong>Proveitos — vendas de mercadorias</strong></td><td data-label="Conta">61 — Vendas</td><td data-label="Valor" style={{ textAlign: 'right' }}>{formatKz(profit.salesNet)}</td></tr>
                <tr><td data-label="Rubrica">IVA liquidado</td><td data-label="Conta">34.5 — IVA</td><td data-label="Valor" style={{ textAlign: 'right' }}>{formatKz(profit.ivaTotal)}</td></tr>
                <tr><td data-label="Rubrica">(−) CMVMC — custo das mercadorias vendidas</td><td data-label="Conta">71 — CMVMC</td><td data-label="Valor" style={{ textAlign: 'right', color: 'var(--danger)' }}>− {formatKz(profit.costTotal)}</td></tr>
                <tr><td data-label="Rubrica"><strong>= Resultado bruto</strong></td><td data-label="Conta" /><td data-label="Valor" style={{ textAlign: 'right' }}><strong>{formatKz(profit.grossProfit)}</strong></td></tr>
                <tr><td data-label="Rubrica">(−) Gastos operacionais</td><td data-label="Conta">72/75 — FSE e outros</td><td data-label="Valor" style={{ textAlign: 'right', color: 'var(--danger)' }}>− {formatKz(profit.otherExpenses)}</td></tr>
                <tr><td data-label="Rubrica"><strong>= Resultado líquido do período</strong></td><td data-label="Conta">88 — Resultados</td><td data-label="Valor" style={{ textAlign: 'right' }}><strong style={{ color: profit.netProfit < 0 ? 'var(--danger)' : 'var(--success)' }}>{formatKz(profit.netProfit)}</strong></td></tr>
              </tbody>
            </table>
            {profit.cancelledCount > 0 ? (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Nota: {profit.cancelledCount} documento(s) anulado(s) no valor de {formatKz(profit.cancelledAmount)} (notas de crédito) — já excluídos dos proveitos.
              </p>
            ) : null}
          </div>

          {/* Apuramento de IVA */}
          <div className="card">
            <h3>Apuramento de IVA por taxa — {range.label}</h3>
            {tax.length === 0 ? <div className="empty" style={{ padding: 18 }}><p>Sem documentos no período.</p></div> : (
              <table className="ptable stack">
                <thead><tr><th>Taxa</th><th style={{ textAlign: 'right' }}>Base tributável</th><th style={{ textAlign: 'right' }}>IVA</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  {tax.map((r, i) => (
                    <tr key={i}>
                      <td data-label="Taxa">{r.rate}%</td>
                      <td data-label="Base" style={{ textAlign: 'right' }}>{formatKz(Number(r.net))}</td>
                      <td data-label="IVA" style={{ textAlign: 'right' }}>{formatKz(Number(r.iva))}</td>
                      <td data-label="Total" style={{ textAlign: 'right' }}>{formatKz(Number(r.gross))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td data-label="Taxa"><strong>Total</strong></td>
                    <td data-label="Base" style={{ textAlign: 'right' }}><strong>{formatKz(tax.reduce((s, r) => s + Number(r.net), 0))}</strong></td>
                    <td data-label="IVA" style={{ textAlign: 'right' }}><strong>{formatKz(ivaTotal)}</strong></td>
                    <td data-label="Total" style={{ textAlign: 'right' }}><strong>{formatKz(tax.reduce((s, r) => s + Number(r.gross), 0))}</strong></td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              O ficheiro oficial mensal (SAF-T AGT) gera-se em <strong>Fiscal · SAF-T</strong>; este mapa segue os mesmos documentos certificados.
            </p>
          </div>

          {/* Gastos por categoria */}
          <div className="card">
            <h3>Gastos do período por categoria</h3>
            {!exp || exp.byCategory.length === 0 ? <div className="empty" style={{ padding: 18 }}><p>Sem gastos registados.</p></div> : (
              <table className="ptable stack">
                <thead><tr><th>Categoria</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  {exp.byCategory.map((c, i) => (
                    <tr key={i}><td data-label="Categoria">{(c as { category: string }).category}</td>
                      <td data-label="Total" style={{ textAlign: 'right' }}>{formatKz(Number((c as { total: number }).total))}</td></tr>
                  ))}
                  <tr><td data-label="Categoria"><strong>Total de gastos</strong></td>
                    <td data-label="Total" style={{ textAlign: 'right' }}><strong>{formatKz(exp.total)}</strong></td></tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
