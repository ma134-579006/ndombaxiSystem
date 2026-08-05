import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Skeleton } from '@nexus/ui';
import { api, ApiError } from '../api/client';
import { newUuid } from '../offline/db';
import type { DocumentIdentity, ReceiptFiscalInfo, SaleDetail, SaleRow } from '../api/types';
import { formatKz } from '../format';
import { ReceiptModal } from './ReceiptModal';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDateTime = (s: string) => { try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; } };

/** Badge do ESTADO do documento (ciclo de vida DP 71/25): Paga / Por pagar /
 *  Parcial / Anulada. Cai no `status` fiscal ('A') se não houver `doc_state`. */
function stateBadge(r: SaleRow): React.ReactNode {
  const st = r.status === 'A' ? 'ANNULLED' : (r.doc_state || 'PAID');
  switch (st) {
    case 'ANNULLED': return <span className="pill off">Anulada</span>;
    case 'PAID': return <span className="pill on">Paga</span>;
    case 'PARTIALLY_PAID': return <span className="pill warn">Parcial</span>;
    case 'ISSUED': return <span className="pill">Por pagar</span>;
    default: return <span className="pill on">Válida</span>;
  }
}

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

  // Seleção múltipla (gerente/gestor): permite marcar várias vendas — ou TODAS —
  // e anulá-las em lote (cada uma gera a sua nota de crédito; nada se apaga).
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setRows(await api.listSales(from, to)); setSel(new Set()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar vendas.'); }
    finally { setLoading(false); }
  }, [from, to]);

  // Filtra AUTOMATICAMENTE ao mudar as datas (sem botão "Filtrar").
  useEffect(() => { void load(); }, [load]);

  // Só vendas VÁLIDAS (não anuladas) podem ser selecionadas para anular.
  const cancellable = rows.filter((r) => r.status !== 'A');
  const allSel = cancellable.length > 0 && cancellable.every((r) => sel.has(r.id));
  const toggleOne = (id: string) =>
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSel ? new Set() : new Set(cancellable.map((r) => r.id)));

  // Anula em LOTE todas as vendas selecionadas (NC por cada uma). Continua mesmo
  // que uma falhe, e no fim relata quantas foram anuladas.
  const cancelSelected = async () => {
    const ids = cancellable.filter((r) => sel.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Anular ${ids.length} venda(s) selecionada(s)? Cada uma gera uma nota de crédito (estorna stock e financeiro). Esta ação não se apaga.`)) return;
    setBulkBusy(true); setErr(null); setMsg(null);
    let ok = 0; const fails: string[] = [];
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      try { await api.cancelInvoice(id, 'Anulação em lote (histórico de vendas)'); ok += 1; }
      catch (e) { fails.push(`${row?.number ?? id}: ${e instanceof ApiError ? e.message : 'erro'}`); }
    }
    setBulkBusy(false);
    if (ok > 0) setMsg(`${ok} venda(s) anulada(s). Stock e financeiro revertidos (notas de crédito).`);
    if (fails.length) setErr(`Não foi possível anular ${fails.length}: ${fails.slice(0, 3).join(' · ')}${fails.length > 3 ? '…' : ''}`);
    await load(); onChanged?.();
  };

  // Cancelamento POR PRODUTO: abre o detalhe da venda para escolher artigos.
  const [cancelTarget, setCancelTarget] = useState<SaleRow | null>(null);
  const onCancelled = async (info: string) => { setCancelTarget(null); setMsg(info); await load(); onChanged?.(); };

  return (
    <>
    <Dialog open onClose={onClose} title="Histórico de vendas" size="xl">
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

        {canCancel && cancellable.length > 0 ? (
          <div className="sm-bulk">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todas as vendas" />
              Selecionar todas ({cancellable.length})
            </label>
            <span className="muted">{sel.size > 0 ? `· ${sel.size} marcada(s)` : ''}</span>
            <span style={{ flex: 1 }} />
            {sel.size > 0 ? (
              <button className="btn sm ghost" onClick={() => setSel(new Set())} disabled={bulkBusy}>Limpar</button>
            ) : null}
            <button className="btn sm danger" onClick={() => void cancelSelected()} disabled={bulkBusy || sel.size === 0}>
              {bulkBusy ? 'A anular…' : `✖ Anular selecionadas${sel.size > 0 ? ` (${sel.size})` : ''}`}
            </button>
          </div>
        ) : null}

        <div className="sm-list">
          {rows.length === 0 && !loading ? <div className="empty">Sem vendas no período.</div> : (
            <table className="sales-table">
              <thead>
                <tr>
                  {canCancel ? (
                    <th style={{ width: 30 }}>
                      <input type="checkbox" checked={allSel} onChange={toggleAll}
                        disabled={cancellable.length === 0} title="Selecionar todas" aria-label="Selecionar todas as vendas" />
                    </th>
                  ) : null}
                  <th>Documento</th><th>Data</th><th>Produtos</th><th>Operador</th><th>Total</th><th>Estado</th><th>2ª via</th>
                  {canCancel ? <th>Cancelar</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cancelled = r.status === 'A';
                  return (
                    <tr key={r.id} className={cancelled ? 'cancelled' : ''}>
                      {canCancel ? (
                        <td className="sel-cell" data-label="">
                          {!cancelled ? (
                            <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleOne(r.id)}
                              aria-label={`Selecionar venda ${r.number}`} />
                          ) : null}
                        </td>
                      ) : null}
                      <td data-label="Documento">{r.number}</td>
                      <td data-label="Data">{fmtDateTime(r.system_entry_date)}</td>
                      <td data-label="Produtos" style={{ maxWidth: 280 }}>{r.items || '—'}</td>
                      <td data-label="Operador">{r.cashier_name || '—'}</td>
                      <td data-label="Total" style={{ fontWeight: 700 }}>{formatKz(Number(r.gross_total))}</td>
                      <td data-label="Estado">{stateBadge(r)}</td>
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
    </Dialog>

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
  /**
   * Chave desta devolução. Sobrevive a uma tentativa falhada (para o reenvio ser
   * reconhecido como o MESMO pedido) mas é descartada assim que o operador mexe
   * nas quantidades — nessa altura a intenção mudou, e reutilizar a chave faria
   * o servidor devolver silenciosamente a nota de crédito ANTERIOR.
   */
  const returnOpIdRef = useRef<string | null>(null);
  useEffect(() => { returnOpIdRef.current = null; }, [qty]);
  const [reason, setReason] = useState('Cancelamento na caixa');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.getSale(sale.id).then(setDetail).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao abrir a venda.'));
  }, [sale.id]);

  const lines = detail?.items ?? [];
  // REMANESCENTE por linha: vendido − já devolvido em NCs anteriores. É esse o
  // máximo cancelável (o servidor também valida — dupla proteção fiscal).
  const remainingOf = (l: { quantity: number; returnedQuantity?: number }) =>
    Math.max(0, l.quantity - (l.returnedQuantity ?? 0));
  const setLineQty = (code: string, max: number, v: number) =>
    // Arredonda a 3 casas (produtos a peso vendem 0,5 kg — Math.floor impedia).
    setQty((s) => ({ ...s, [code]: Math.max(0, Math.min(max, Math.round((v || 0) * 1000) / 1000)) }));
  const toggle = (code: string, max: number) =>
    setQty((s) => ({ ...s, [code]: s[code] ? 0 : max }));
  const selected = lines.filter((l) => (qty[l.productCode] ?? 0) > 0);
  const refund = selected.reduce((acc, l) => acc + l.unitPrice * (qty[l.productCode] ?? 0), 0);
  const isFull = lines.length > 0 && lines.every((l) => (qty[l.productCode] ?? 0) >= remainingOf(l));

  const confirm = async () => {
    if (selected.length === 0) { setErr('Selecione pelo menos um artigo.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = reason.trim() || 'Cancelamento na caixa';
      if (isFull) {
        // A anulação total é idempotente no servidor (a 2.ª tentativa é recusada
        // com "já foi anulada"), por isso não precisa de chave.
        await api.cancelInvoice(sale.id, r);
        onDone(`Venda ${sale.number} anulada. Stock e financeiro revertidos (nota de crédito).`);
      } else {
        // A devolução PARCIAL não é idempotente sozinha: se a resposta se perder
        // e o operador repetir, o remanescente ainda permite e nascia uma 2.ª
        // nota de crédito. A chave é criada uma vez e reutilizada nas tentativas
        // seguintes DESTA mesma devolução (é limpa se ele mudar as quantidades).
        if (!returnOpIdRef.current) returnOpIdRef.current = newUuid();
        await api.returnItems(sale.id, selected.map((l) => ({ productCode: l.productCode, quantity: qty[l.productCode] })), r, returnOpIdRef.current);
        onDone(`${selected.length} artigo(s) cancelado(s) na venda ${sale.number} (nota de crédito parcial).`);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao cancelar.');
      setBusy(false);
    }
  };

  return (
    // Anular gera nota de crédito e mexe em stock e caixa: com o pedido a
    // decorrer, o clique no fundo não pode fechar o diálogo a meio.
    <Dialog open onClose={onClose} title={`Cancelar artigos — ${sale.number}`} dismissable={!busy}>
        {err ? <div className="banner danger" role="alert">{err}</div> : null}
        {!detail ? <Skeleton lines={4} height={28} /> : (
          <>
            <div className="sm-list">
              <table className="sales-table">
                <thead><tr><th></th><th>Artigo</th><th>Vendido</th><th>Cancelar qtd.</th><th>Valor</th></tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const q = qty[l.productCode] ?? 0;
                    const rem = remainingOf(l);
                    return (
                      <tr key={l.productCode + l.description} style={rem <= 0 ? { opacity: .55 } : undefined}>
                        <td><input type="checkbox" checked={q > 0} disabled={rem <= 0} onChange={() => toggle(l.productCode, rem)} /></td>
                        <td data-label="Artigo">{l.description}</td>
                        <td data-label="Vendido">
                          {l.quantity}
                          {(l.returnedQuantity ?? 0) > 0 ? <span className="muted"> (resta {rem})</span> : null}
                        </td>
                        <td data-label="Cancelar qtd.">
                          <input type="number" min={0} max={rem} value={q} disabled={rem <= 0}
                            onChange={(e) => setLineQty(l.productCode, rem, Number(e.target.value))}
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
              <Button variant="danger" loading={busy} onClick={() => void confirm()} disabled={selected.length === 0}>
                {busy ? 'A cancelar…' : isFull ? 'Anular venda' : 'Cancelar artigos'}
              </Button>
            </div>
          </>
        )}
    </Dialog>
  );
}
