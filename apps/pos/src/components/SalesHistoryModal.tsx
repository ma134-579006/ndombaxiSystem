import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { DocumentIdentity, ReceiptFiscalInfo, SaleDetail, SaleRow } from '../api/types';
import { formatKz } from '../format';
import { ReceiptModal } from './ReceiptModal';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDateTime = (s: string) => { try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; } };

/**
 * Histórico de vendas da caixa: lista as vendas por período, permite marcar
 * uma/várias (ou todas) e cancelar (estorna stock + financeiro via nota de
 * crédito, 100% registado). Fecha por cima de tudo.
 */
export function SalesHistoryModal({ onClose, onChanged, canCancel = false }: { onClose(): void; onChanged?(): void; canCancel?: boolean }) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Reimpressão (2ª via): dados fiscais + identidade + documento a mostrar.
  const [info, setInfo] = useState<ReceiptFiscalInfo | null>(null);
  const [identity, setIdentity] = useState<DocumentIdentity | null>(null);
  const [printing, setPrinting] = useState<SaleDetail | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  useEffect(() => {
    api.receiptInfo().then(setInfo).catch(() => undefined);
    api.documentIdentity().then(setIdentity).catch(() => undefined);
  }, []);
  const reprint = async (id: string) => {
    setPrintId(id); setErr(null);
    try { setPrinting(await api.getSale(id)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível abrir o documento.'); }
    finally { setPrintId(null); }
  };

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setRows(await api.listSales(from, to)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar vendas.'); }
    finally { setLoading(false); }
  }, [from, to]);

  // Filtra AUTOMATICAMENTE ao mudar as datas (sem botão "Filtrar").
  useEffect(() => { void load(); }, [load]);

  // Cancelamento POR PRODUTO: abre o detalhe da venda para escolher artigos.
  const [cancelTarget, setCancelTarget] = useState<SaleRow | null>(null);
  const onCancelled = async (info: string) => { setCancelTarget(null); setMsg(info); await load(); onChanged?.(); };

  return (
    <>
    <div className="scan-overlay" onClick={onClose}>
      <div className="sales-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sm-head">
          <h2 style={{ margin: 0 }}>Histórico de vendas</h2>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><span style={{ fontSize: 20 }}>✕</span></button>
        </div>

        <div className="sm-filters">
          <label>De <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>até <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} /></label>
          {loading ? <span className="muted" style={{ fontSize: 12.5 }}>A carregar…</span> : null}
          <span style={{ flex: 1 }} />
          {canCancel
            ? <span className="muted" style={{ fontSize: 12.5 }}>Cancela artigos por venda (seleção múltipla).</span>
            : <span className="muted" style={{ fontSize: 12.5 }}>🔒 Só o gerente/gestor pode cancelar vendas.</span>}
        </div>

        {err ? <div className="banner danger">{err}</div> : null}
        {msg ? <div className="banner success">{msg}</div> : null}

        <div className="sm-list">
          {rows.length === 0 && !loading ? <div className="empty">Sem vendas no período.</div> : (
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Documento</th><th>Data</th><th>Produtos</th><th>Operador</th><th>Total</th><th>Estado</th><th>2ª via</th>
                  {canCancel ? <th>Cancelar</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cancelled = r.status === 'A';
                  return (
                    <tr key={r.id} className={cancelled ? 'cancelled' : ''}>
                      <td data-label="Documento">{r.number}</td>
                      <td data-label="Data">{fmtDateTime(r.system_entry_date)}</td>
                      <td data-label="Produtos" style={{ maxWidth: 280 }}>{r.items || '—'}</td>
                      <td data-label="Operador">{r.cashier_name || '—'}</td>
                      <td data-label="Total" style={{ fontWeight: 700 }}>{formatKz(Number(r.gross_total))}</td>
                      <td data-label="Estado">{cancelled ? <span className="pill off">Anulada</span> : <span className="pill on">Válida</span>}</td>
                      <td data-label="2ª via">
                        <button className="btn sm ghost" onClick={() => void reprint(r.id)} disabled={printId === r.id} title="Imprimir 2ª via">
                          {printId === r.id ? '…' : '🖨 Imprimir'}
                        </button>
                      </td>
                      {canCancel ? (
                        <td data-label="Cancelar">
                          {!cancelled ? (
                            <button className="btn sm danger" onClick={() => setCancelTarget(r)} title="Cancelar artigos desta venda">✖ Cancelar</button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>

    {cancelTarget ? (
      <CancelItemsModal sale={cancelTarget} onClose={() => setCancelTarget(null)} onDone={onCancelled} />
    ) : null}

    {printing ? (
      <ReceiptModal
        invoice={printing.invoice}
        info={info}
        identity={identity}
        customerName={printing.customerName}
        operatorName={printing.cashierName}
        items={printing.items}
        reprint
        dateLabel={new Date(printing.operationDate ? printing.operationDate + 'T00:00:00' : printing.date).toLocaleString('pt-PT')}
        onClose={() => setPrinting(null)}
      />
    ) : null}
    </>
  );
}

/**
 * Cancela ARTIGOS de uma venda: abre as linhas, permite selecionar vários e a
 * quantidade a devolver de cada um. Selecionar tudo na quantidade total → anula
 * a venda inteira (NC total); caso contrário emite uma NC PARCIAL (estorna só
 * esses artigos: stock + valor). Não cancela um "carrinho completo" por engano.
 */
function CancelItemsModal({ sale, onClose, onDone }: { sale: SaleRow; onClose(): void; onDone(info: string): void }) {
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('Cancelamento na caixa');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.getSale(sale.id).then(setDetail).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao abrir a venda.'));
  }, [sale.id]);

  const lines = detail?.items ?? [];
  const setLineQty = (code: string, max: number, v: number) =>
    setQty((s) => ({ ...s, [code]: Math.max(0, Math.min(max, Math.floor(v) || 0)) }));
  const toggle = (code: string, max: number) =>
    setQty((s) => ({ ...s, [code]: s[code] ? 0 : max }));
  const selected = lines.filter((l) => (qty[l.productCode] ?? 0) > 0);
  const refund = selected.reduce((acc, l) => acc + l.unitPrice * (qty[l.productCode] ?? 0), 0);
  const isFull = lines.length > 0 && lines.every((l) => (qty[l.productCode] ?? 0) >= l.quantity);

  const confirm = async () => {
    if (selected.length === 0) { setErr('Selecione pelo menos um artigo.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = reason.trim() || 'Cancelamento na caixa';
      if (isFull) {
        await api.cancelInvoice(sale.id, r);
        onDone(`Venda ${sale.number} anulada. Stock e financeiro revertidos (nota de crédito).`);
      } else {
        await api.returnItems(sale.id, selected.map((l) => ({ productCode: l.productCode, quantity: qty[l.productCode] })), r);
        onDone(`${selected.length} artigo(s) cancelado(s) na venda ${sale.number} (nota de crédito parcial).`);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao cancelar.');
      setBusy(false);
    }
  };

  return (
    <div className="scan-overlay" onClick={onClose}>
      <div className="sales-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="sm-head">
          <h2 style={{ margin: 0 }}>Cancelar artigos — {sale.number}</h2>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><span style={{ fontSize: 20 }}>✕</span></button>
        </div>
        {err ? <div className="banner danger">{err}</div> : null}
        {!detail ? <div className="empty">A carregar artigos…</div> : (
          <>
            <div className="sm-list">
              <table className="sales-table">
                <thead><tr><th></th><th>Artigo</th><th>Vendido</th><th>Cancelar qtd.</th><th>Valor</th></tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const q = qty[l.productCode] ?? 0;
                    return (
                      <tr key={l.productCode + l.description}>
                        <td><input type="checkbox" checked={q > 0} onChange={() => toggle(l.productCode, l.quantity)} /></td>
                        <td data-label="Artigo">{l.description}</td>
                        <td data-label="Vendido">{l.quantity}</td>
                        <td data-label="Cancelar qtd.">
                          <input type="number" min={0} max={l.quantity} value={q}
                            onChange={(e) => setLineQty(l.productCode, l.quantity, Number(e.target.value))}
                            style={{ width: 64 }} />
                        </td>
                        <td data-label="Valor" style={{ fontWeight: 700 }}>{formatKz(l.unitPrice * q)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sm-filters" style={{ alignItems: 'center' }}>
              <label style={{ flex: 1 }}>Motivo <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%' }} /></label>
            </div>
            <div className="sm-filters" style={{ alignItems: 'center' }}>
              <span className="muted">{isFull ? 'Anula a venda inteira' : `${selected.length} artigo(s) selecionado(s)`}</span>
              <span style={{ flex: 1 }} />
              <strong style={{ fontSize: 18 }}>{formatKz(refund)}</strong>
              <button className="btn danger" onClick={() => void confirm()} disabled={busy || selected.length === 0}>
                {busy ? 'A cancelar…' : isFull ? 'Anular venda' : 'Cancelar artigos'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
