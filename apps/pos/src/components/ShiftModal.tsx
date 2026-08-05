import React, { useState } from 'react';
import { Button, Dialog } from '@nexus/ui';
import { api, ApiError } from '../api/client';
import type { CashSession, DocumentIdentity, ReportX, ShiftClose } from '../api/types';
import { copyrightLine } from '../brand';
import { formatKz, formatDateTime } from '../format';
import { IconCheck } from './Icons';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { PaperSizeToggle } from './PaperSizeToggle';
import { buildShiftClosePdf, shiftFileName } from '../pdf/shiftPdf';

interface Props {
  session: CashSession | null;
  /** Nº de artigos no carrinho — impede o fecho com venda por finalizar. */
  cartCount?: number;
  identity?: DocumentIdentity | null;
  operatorName?: string | null;
  onOpened(): void;
  onClosed(): void;
  onClose(): void;
}

/** Abertura / fecho de turno de caixa, com conferência de dinheiro (quebra/sobra). */
export function ShiftModal({ session, cartCount = 0, identity, operatorName, onOpened, onClosed, onClose }: Props) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const savePdf = async (r: ShiftClose) => {
    setPdfBusy(true);
    try {
      const doc = await buildShiftClosePdf({ result: r, identity, operatorName });
      const name = shiftFileName(r);
      try {
        const url = doc.output('bloburl');
        const w = window.open(url as unknown as string, '_blank');
        if (!w) doc.save(name);
      } catch { doc.save(name); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível gerar o PDF.'); }
    finally { setPdfBusy(false); }
  };

  // Envia o RESUMO do fecho por WhatsApp (texto legível). No telemóvel usa a
  // partilha nativa (escolhe WhatsApp e outras apps); no PC abre o WhatsApp Web.
  const shareWhatsAppShift = (r: ShiftClose) => {
    const empresa = identity?.companyName || identity?.brandName || 'Fecho de caixa';
    const verdict = r.verdict === 'OK' ? '✅ Caixa certo'
      : r.verdict === 'QUEBRA' ? `🔴 Quebra de ${formatKz(Math.abs(r.difference))}`
      : `🟠 Sobra de ${formatKz(r.difference)}`;
    const L: string[] = [`*${empresa}* — Fecho de turno`];
    if (operatorName || r.openedByName) L.push(`Operador: ${operatorName || r.openedByName}`);
    L.push(`Data: ${formatDateTime()}`, '',
      `Fundo inicial: ${formatKz(r.openingFloat)}`,
      `Vendas: ${formatKz(r.salesTotal)} (${r.salesCount})`,
      `• Numerário: ${formatKz(r.cashSales)}`);
    if (r.cardSales > 0) L.push(`• Cartão/TPA: ${formatKz(r.cardSales)}`);
    if ((r.byPayment?.TRANSFER ?? 0) > 0) L.push(`• Transferência: ${formatKz(r.byPayment!.TRANSFER)}`);
    if ((r.byPayment?.REFERENCE ?? 0) > 0) L.push(`• Referência: ${formatKz(r.byPayment!.REFERENCE)}`);
    if ((r.byPayment?.EXPRESS ?? 0) > 0) L.push(`• Multicaixa Express: ${formatKz(r.byPayment!.EXPRESS)}`);
    if ((r.creditSales ?? 0) > 0) L.push(`• A crédito (fiado, por cobrar): ${formatKz(r.creditSales!)}`);
    if (r.cashIn > 0) L.push(`Reforços: ${formatKz(r.cashIn)}`);
    if (r.cashOut > 0) L.push(`Sangrias: −${formatKz(r.cashOut)}`);
    if (r.advancesPaid > 0) L.push(`Adiantamentos: −${formatKz(r.advancesPaid)}`);
    L.push('',
      `Esperado (gaveta): ${formatKz(r.expected)}`,
      `Contado: ${formatKz(r.counted)}`,
      `*${verdict}*`);
    const texto = encodeURIComponent(L.join('\n'));
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    if (nav.share) {
      void nav.share({ title: `${empresa} · Fecho`, text: decodeURIComponent(texto) })
        .catch(() => window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener'));
    } else {
      window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener');
    }
  };
  const [openingFloat, setOpeningFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<ShiftClose | null>(null);
  const [xReport, setXReport] = useState<ReportX | null>(null);

  const loadX = async () => {
    setError(null); setBusy(true);
    try { setXReport(await api.reportX()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível ler o relatório X.'); }
    finally { setBusy(false); }
  };

  const open = async () => {
    setError(null);
    const float = Number(openingFloat) || 0;
    setBusy(true);
    try {
      await api.openSession(float);
      onOpened();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível abrir o turno.');
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setError(null);
    if (cartCount > 0) {
      setError(`Tem ${cartCount} artigo(s) no carrinho por finalizar. Finalize a venda (ou limpe o carrinho) antes de fechar o turno.`);
      return;
    }
    if (counted.trim() === '') {
      setError('Indique o valor contado em dinheiro.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.closeSession(Number(counted) || 0, notes.trim() || undefined);
      setCloseResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível fechar o turno.');
    } finally {
      setBusy(false);
    }
  };

  // ── Recibo de fecho ──────────────────────────────────────
  if (closeResult) {
    const r = closeResult;
    const tone = r.verdict === 'OK' ? 'var(--success)' : r.verdict === 'QUEBRA' ? 'var(--danger)' : 'var(--warning)';
    return (
      <div className="modal-bg" onClick={() => { onClosed(); }}>
        <div className="card receipt" onClick={(e) => e.stopPropagation()}>
          <div className="r-head" style={{ background: 'var(--surface-2)' }}>
            <div className="num">Fecho de turno</div>
            <div className="sub">{r.openedByName} · {formatDateTime()}</div>
          </div>
          <div className="r-body">
            <div className="banner" style={{ marginBottom: 12, justifyContent: 'center', background: 'transparent', border: `1px solid ${tone}`, color: tone, fontSize: 16, fontWeight: 900 }}>
              {r.verdict === 'OK' ? '✓ CAIXA CERTO' : r.verdict === 'QUEBRA' ? `QUEBRA DE CAIXA ${formatKz(Math.abs(r.difference))}` : `SOBRA ${formatKz(r.difference)}`}
            </div>
            <div className="kv"><span className="k">Fundo inicial</span><span className="v">{formatKz(r.openingFloat)}</span></div>
            <div className="kv"><span className="k">Vendas (total)</span><span className="v">{formatKz(r.salesTotal)} · {r.salesCount}</span></div>
            <div className="kv"><span className="k" style={{ paddingLeft: 10 }}>· em numerário</span><span className="v">{formatKz(r.cashSales)}</span></div>
            {r.cardSales > 0 ? <div className="kv"><span className="k" style={{ paddingLeft: 10 }}>· em cartão/Multicaixa (TPA)</span><span className="v">{formatKz(r.cardSales)}</span></div> : null}
            {(r.byPayment?.TRANSFER ?? 0) > 0 ? <div className="kv"><span className="k" style={{ paddingLeft: 10 }}>· por transferência</span><span className="v">{formatKz(r.byPayment!.TRANSFER)}</span></div> : null}
            {(r.byPayment?.REFERENCE ?? 0) > 0 ? <div className="kv"><span className="k" style={{ paddingLeft: 10 }}>· por referência</span><span className="v">{formatKz(r.byPayment!.REFERENCE)}</span></div> : null}
            {(r.byPayment?.EXPRESS ?? 0) > 0 ? <div className="kv"><span className="k" style={{ paddingLeft: 10 }}>· Multicaixa Express</span><span className="v">{formatKz(r.byPayment!.EXPRESS)}</span></div> : null}
            {(r.creditSales ?? 0) > 0 ? <div className="kv"><span className="k" style={{ paddingLeft: 10 }}>· a crédito (fiado, por cobrar)</span><span className="v">{formatKz(r.creditSales!)}</span></div> : null}
            {r.cashIn > 0 ? <div className="kv"><span className="k">Reforços</span><span className="v">{formatKz(r.cashIn)}</span></div> : null}
            {r.cashOut > 0 ? <div className="kv"><span className="k">Sangrias</span><span className="v">−{formatKz(r.cashOut)}</span></div> : null}
            {r.cashRefunds > 0 ? <div className="kv"><span className="k">Reembolsos</span><span className="v">−{formatKz(r.cashRefunds)}</span></div> : null}
            {r.advancesPaid > 0 ? <div className="kv"><span className="k">Adiantamentos levantados (aprovados)</span><span className="v">−{formatKz(r.advancesPaid)}</span></div> : null}
            <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10 }}>
              <span className="k">Esperado na gaveta (só dinheiro)</span><span className="v">{formatKz(r.expected)}</span>
            </div>
            <div className="kv"><span className="k">Contado (físico)</span><span className="v">{formatKz(r.counted)}</span></div>
            <div className="kv"><span className="k">Diferença</span><span className="v" style={{ color: tone }}>{formatKz(r.difference)}</span></div>
            {r.cardSales > 0 ? <div className="legend" style={{ textAlign: 'left', marginTop: 8 }}>As vendas em <strong>cartão/TPA</strong> ({formatKz(r.cardSales)}) não entram na gaveta — não contam para a quebra.</div> : null}
            {r.breakReason ? <div className="banner danger" style={{ marginTop: 10, fontSize: 13 }}>⚠️ {r.breakReason}</div> : null}

            {r.products.length > 0 ? (
              <div className="legend" style={{ textAlign: 'left' }}>
                <strong>Produtos vendidos no turno:</strong>
                {r.products.map((p) => (
                  <div key={p.productCode}>{p.quantity}× {p.description} — {formatKz(p.grossTotal)}</div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="receipt-credit">{copyrightLine()}</div>
          <PaperSizeToggle />
          <div className="shift-actions">
            <button className="btn ghost lg shift-act" onClick={() => window.print()} title="Impressora térmica (80/58mm)">
              <span className="ic" aria-hidden>🖨</span> Imprimir
            </button>
            <button className="btn ghost lg shift-act" onClick={() => void savePdf(r)} disabled={pdfBusy}>
              <span className="ic" aria-hidden>⬇️</span> {pdfBusy ? 'A gerar…' : 'PDF (A4)'}
            </button>
            <button className="btn lg shift-act shift-wa" onClick={() => shareWhatsAppShift(r)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden>
                <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.004c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.02zM12.05 20.15h-.004a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/>
              </svg>
              WhatsApp
            </button>
            <button className="btn success lg shift-act shift-done" onClick={onClosed} autoFocus>
              <IconCheck size={17} /> Concluir
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Relatório X (leitura do turno sem fechar) ────────────
  if (xReport) {
    const x = xReport;
    const PT: Record<string, string> = {
      CASH: 'Numerário', CARD: 'Multicaixa/Cartão', TRANSFER: 'Transferência',
      REFERENCE: 'Referência', EXPRESS: 'Multicaixa Express', CREDIT: 'A crédito',
    };
    return (
      <div className="modal-bg" onClick={() => setXReport(null)}>
        <div className="card receipt" onClick={(e) => e.stopPropagation()}>
          <div className="r-head" style={{ background: 'var(--surface-2)' }}>
            <div className="num">Relatório X</div>
            <div className="sub">{x.openedByName} · {formatDateTime()}</div>
          </div>
          <div className="r-body">
            <div className="banner info" style={{ marginBottom: 12, justifyContent: 'center' }}>Leitura do turno (sem fechar)</div>
            <div className="kv"><span className="k">Fundo inicial</span><span className="v">{formatKz(x.openingFloat)}</span></div>
            <div className="kv"><span className="k">Vendas (total)</span><span className="v">{formatKz(x.salesTotal)} · {x.salesCount}</span></div>
            {Object.entries(x.byPayment).map(([pt, v]) => (
              <div className="kv" key={pt}><span className="k" style={{ paddingLeft: 10 }}>· {PT[pt] ?? pt}</span><span className="v">{formatKz(v)}</span></div>
            ))}
            {x.cashIn > 0 ? <div className="kv"><span className="k">Reforços</span><span className="v">{formatKz(x.cashIn)}</span></div> : null}
            {x.cashOut > 0 ? <div className="kv"><span className="k">Sangrias</span><span className="v">−{formatKz(x.cashOut)}</span></div> : null}
            {x.advancesApproved > 0 ? <div className="kv"><span className="k">Adiantamentos aprovados (a levantar)</span><span className="v">−{formatKz(x.advancesApproved)}</span></div> : null}
            <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10 }}>
              <span className="k">Esperado em numerário</span><span className="v grand">{formatKz(x.expectedCash)}</span>
            </div>
            {x.cardSales > 0 ? <div className="legend" style={{ textAlign: 'left', marginTop: 8 }}>Cartão/TPA: <strong>{formatKz(x.cardSales)}</strong> (não entra na gaveta).</div> : null}
          </div>
          <div className="receipt-credit">{copyrightLine()}</div>
          <PaperSizeToggle />
          <div className="r-foot" style={{ display: 'flex', gap: 10 }}>
            <button className="btn ghost lg" style={{ flex: 1 }} onClick={() => window.print()}>Imprimir</button>
            <button className="btn lg" style={{ flex: 1 }} onClick={() => setXReport(null)} autoFocus>Voltar</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Abrir turno ──────────────────────────────────────────
  if (!session) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Abrir turno de caixa"
        size="sm"
        footer={
          <Button variant="primary" size="lg" block loading={busy} onClick={open}>
            {busy ? 'A abrir…' : 'Abrir turno'}
          </Button>
        }
      >
        {error ? <div className="banner danger" role="alert">{error}</div> : null}
        <KeyboardInput label="Fundo de troco inicial (Kz)" value={openingFloat} onChange={setOpeningFloat} numeric placeholder="0" onSubmit={open} />
      </Dialog>
    );
  }

  // ── Fechar turno ─────────────────────────────────────────
  return (
    <Dialog
      open
      onClose={onClose}
      title="Fechar turno"
      description={`Aberto por ${session.opened_by_name} · ${new Date(session.opened_at).toLocaleString('pt-PT')}`}
      size="sm"
      // Fechar o turno é irreversível (emite o Z). Com o diálogo a meio de uma
      // contagem, um clique no fundo não pode deitar fora o valor já contado.
      dismissable={!busy}
      footer={
        <div className="nx-stack-2" style={{ width: '100%' }}>
          <Button variant="secondary" size="lg" block onClick={loadX} disabled={busy}>
            Relatório X (ler sem fechar)
          </Button>
          <Button variant="danger" size="lg" block loading={busy} onClick={close} disabled={cartCount > 0}>
            {busy ? 'A fechar…' : 'Fechar turno e conferir (Z)'}
          </Button>
        </div>
      }
    >
      {error ? <div className="banner danger" role="alert">{error}</div> : null}
      {cartCount > 0 ? (
        <div className="banner warn" role="alert">
          ⚠️ Há {cartCount} artigo(s) no carrinho por finalizar. Finalize a venda (ou limpe o carrinho) antes de
          fechar o turno.
        </div>
      ) : null}
      <KeyboardInput label="Dinheiro contado na gaveta (Kz)" value={counted} onChange={setCounted} numeric placeholder="0" onSubmit={close} />
      <KeyboardInput label="Observações (opcional)" value={notes} onChange={setNotes} placeholder="ex.: nota sobre o turno" />
    </Dialog>
  );
}
