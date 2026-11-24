import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { DocumentIdentity, EmittedInvoice } from '../api/types';
import { formatKz } from '../format';
import { getPaper } from '../print';
import { pairPrinter, pairedPrinterName, printBytes, rawPrintSupported } from '../escpos';
import { isCapacitorApp as isNativeApp, saveNativePdf, shareNativePdf } from '../offline/nativeShare';
import { PaperSizeToggle } from './PaperSizeToggle';
import { UiIcon } from './UiIcon';

/** Venda cujo documento fiscal é do motor externo (resposta do POS ou série interna VND na 2.ª via). */
export function isExternalFiscal(invoice: EmittedInvoice): boolean {
  return invoice.fiscal?.engine === 'VENDUS' || /^[A-Z]{2} VND\d{4}\//.test(invoice.number ?? '');
}

const STATE_LABEL: Record<string, string> = {
  A_PREPARAR: 'A preparar',
  A_ENVIAR: 'A enviar',
  CRIADO_NO_VENDUS: 'Criado no Cegid Vendus',
  COMUNICACAO_AGT_PENDENTE: 'Comunicação AGT pendente',
  AGT_ACEITE: 'Aceite pela AGT',
  AGT_REJEITADO: 'Rejeitado pela AGT',
  ESTADO_DESCONHECIDO: 'A confirmar com o Cegid Vendus',
  ERRO_DE_COMUNICACAO: 'Erro de comunicação',
  CORRECCAO_NECESSARIA: 'Correcção necessária',
};

type Doc = { id: string | null; state: string; number: string | null; agt?: string | null; pdf: boolean; error: string | null };

/** Nome do ficheiro: o número fiscal do Vendus (ex.: "FR_02P2026_5.pdf"). */
function pdfName(doc: Doc | null, invoice: EmittedInvoice): string {
  return `${(doc?.agt ?? doc?.number ?? invoice.internalNumber ?? invoice.number ?? 'fatura').replace(/[^\w.-]+/g, '_')}.pdf`;
}

/** Base64 → bytes (talão ESC/POS do Vendus). */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Imprime o HTML do talão (gerado pelo Vendus) num iframe escondido, com a página
 * na largura da térmica deste posto (80/58 mm). O conteúdo é o do Vendus, intacto.
 */
function printHtml(html: string, paper: '80' | '58'): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    const page = `<style>@page{size:${paper}mm auto;margin:0}html,body{margin:0}</style>`;
    frame.srcdoc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + page) : page + html;
    frame.onload = () => {
      const w = frame.contentWindow;
      const done = () => { setTimeout(() => frame.remove(), 1000); resolve(); };
      if (!w) return done();
      w.addEventListener('afterprint', done, { once: true });
      // Imagens (logótipo, QR) já carregadas: o onload do iframe espera por elas.
      w.focus();
      w.print();
      setTimeout(done, 60_000); // segurança: alguns WebView não emitem afterprint
    };
    document.body.appendChild(frame);
  });
}

/**
 * Documento fiscal emitido pelo Cegid Vendus. O LPS nunca desenha um documento
 * próprio: o TALÃO (térmica) e o PDF A4 vêm ambos do Vendus (série, número, hash
 * e QR intactos). Na 1.ª impressão sai o ORIGINAL; na reimpressão, a 2.ª via.
 */
export function ExternalFiscalReceipt({ invoice, identity, reprint = false, onClose }: { invoice: EmittedInvoice; identity: DocumentIdentity | null; reprint?: boolean; onClose(): void }) {
  const [doc, setDoc] = useState<Doc | null>(invoice.fiscal ?? null);
  const [busy, setBusy] = useState<null | 'print' | 'pdf' | 'share' | 'save' | 'refresh'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [printerName, setPrinterName] = useState<string | null>(() => pairedPrinterName());
  const printedOnce = useRef(reprint);

  const refresh = async (quiet = false) => {
    if (!quiet) setBusy('refresh');
    setErr(null);
    try {
      const r = await api.externalFiscal(invoice.id);
      setDoc(r ? { id: r.id, state: r.state, number: r.number, agt: r.agt_number ?? null, pdf: r.has_pdf, error: r.last_error } : null);
    } catch (e) {
      if (!quiet) setErr(e instanceof Error ? e.message : 'Falha ao consultar');
    } finally {
      if (!quiet) setBusy(null);
    }
  };

  useEffect(() => {
    if (!invoice.fiscal) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  // Enquanto o Vendus não devolve o número/PDF, consulta sozinho (até ~1 min).
  const issued = !!doc?.number;
  const ready = issued && !!doc?.pdf;
  useEffect(() => {
    if (ready) return;
    let n = 0;
    const t = setInterval(() => { n += 1; if (n > 20) clearInterval(t); else void refresh(true); }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, invoice.id]);

  const getPdf = async (): Promise<Blob> => {
    if (!doc?.id) throw new Error('Documento ainda não emitido');
    return api.externalFiscalPdf(doc.id);
  };

  /** Talão na TÉRMICA: ESC/POS directo se houver impressora emparelhada; senão o diálogo. */
  const printThermal = async () => {
    if (!doc?.id) return;
    setBusy('print'); setErr(null); setMsg(null);
    const copy = printedOnce.current ? 'DUPLICATE' : 'ORIGINAL';
    try {
      if (rawPrintSupported() && pairedPrinterName()) {
        const raw = await api.externalFiscalPrint(doc.id, 'escpos', copy).catch(() => null);
        if (raw?.data && (await printBytes(b64ToBytes(raw.data)))) {
          printedOnce.current = true;
          setMsg(copy === 'ORIGINAL' ? 'Talão impresso.' : '2.ª via impressa.');
          return;
        }
      }
      const r = await api.externalFiscalPrint(doc.id, 'html', copy);
      await printHtml(r.data, getPaper());
      printedOnce.current = true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Talão indisponível');
    } finally {
      setBusy(null);
    }
  };

  const openPdf = async () => {
    setBusy('pdf'); setErr(null);
    try {
      const url = URL.createObjectURL(await getPdf());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'PDF indisponível');
    } finally {
      setBusy(null);
    }
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /** Guarda o PDF A4 original no aparelho (app: pasta de documentos; PC: transferências). */
  const savePdf = async () => {
    setBusy('save'); setErr(null); setMsg(null);
    try {
      const blob = await getPdf();
      const name = pdfName(doc, invoice);
      if (isNativeApp()) {
        const where = await saveNativePdf(blob, name);
        setMsg(where ? `PDF guardado: ${where}` : 'PDF guardado.');
      } else {
        download(blob, name);
        setMsg('PDF guardado nas transferências.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'PDF indisponível');
    } finally {
      setBusy(null);
    }
  };

  /** WhatsApp com o PDF A4 ORIGINAL como ficheiro (partilha nativa); no PC descarrega e abre o WhatsApp. */
  const shareWhatsApp = async () => {
    setBusy('share'); setErr(null); setMsg(null);
    const empresa = identity?.companyName || identity?.brandName || 'Fatura';
    const title = doc?.agt ?? doc?.number ?? invoice.number;
    const text = `${empresa} · ${title} · ${formatKz(invoice.grossTotal)}`;
    const openWa = () => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    try {
      const blob = await getPdf();
      const name = pdfName(doc, invoice);
      if (isNativeApp()) {
        if (await shareNativePdf(blob, name, title, text)) return;
        await saveNativePdf(blob, name);
        openWa();
        return;
      }
      const file = new File([blob], name, { type: 'application/pdf' });
      const nav = navigator as Navigator & {
        share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
        canShare?: (d: { files?: File[] }) => boolean;
      };
      if (nav.share && (nav.canShare?.({ files: [file] }) ?? true)) {
        try {
          await nav.share({ files: [file], title, text });
          return;
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return;
        }
      }
      download(blob, name);
      openWa();
      setMsg('PDF descarregado: anexe-o na conversa do WhatsApp.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'PDF indisponível');
    } finally {
      setBusy(null);
    }
  };

  const pairThermal = async () => {
    try {
      const p = await pairPrinter();
      if (p) setPrinterName(p.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível ligar a impressora');
    }
  };

  return (
    <div className="modal-bg receipt-layer" onClick={onClose}>
      <div className="card receipt efr" onClick={(e) => e.stopPropagation()}>
        {identity && (identity.companyName || identity.brandName) ? <div className="vrc-co">{identity.companyName || identity.brandName}</div> : null}
        <dl className="efr-dl">
          <dt>{reprint ? 'Documento fiscal (2.ª via)' : 'Documento fiscal'}</dt>
          <dd className="efr-no">{issued ? (doc!.agt ?? doc!.number) : 'Pendente'}</dd>
          {issued ? <><dt>Nº AGT</dt><dd>{doc!.agt ?? 'Pendente (a AGT ainda não atribuiu)'}</dd></> : null}
          {issued && doc!.agt ? <><dt>Nº Vendus</dt><dd>{doc!.number}</dd></> : null}
          <dt>Software de facturação</dt>
          <dd>Cegid Vendus</dd>
          <dt>Estado</dt>
          <dd>{STATE_LABEL[doc?.state ?? ''] ?? doc?.state ?? '—'}</dd>
          <dt>Total</dt>
          <dd>{formatKz(invoice.grossTotal)}</dd>
          <dt>Ref. interna LPS</dt>
          <dd className="efr-ref">{invoice.internalNumber ?? invoice.number}</dd>
        </dl>
        {doc?.error && !issued ? <div className="vrc-note">{doc.error}</div> : null}
        {!ready && !doc?.error ? <div className="vrc-note">A obter o documento do Cegid Vendus…</div> : null}
        {err ? <div className="vrc-note" role="alert">{err}</div> : null}
        {msg ? <div className="vrc-note" role="status">{msg}</div> : null}
        <PaperSizeToggle />
        {rawPrintSupported() ? (
          <div className="efr-printer">
            <span>{printerName ? `Térmica: ${printerName}` : 'Térmica não ligada (usa o diálogo)'}</span>
            <button className="btn sm ghost" onClick={() => void pairThermal()}>{printerName ? 'Trocar' : 'Ligar impressora'}</button>
          </div>
        ) : null}
        <div className="efr-actions">
          <button className="btn primary" disabled={!!busy || !issued} onClick={() => void printThermal()}>
            {busy === 'print' ? 'A imprimir…' : <><UiIcon e="printer" size={16} /> {reprint ? 'Imprimir 2.ª via' : 'Imprimir talão'}</>}
          </button>
          <button className="btn r-wa" disabled={!!busy || !ready} onClick={() => void shareWhatsApp()}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.004c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.02zM12.05 20.15h-.004a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
            </svg>
            {busy === 'share' ? 'A preparar…' : 'WhatsApp (PDF A4)'}
          </button>
          <button className="btn" disabled={!!busy || !ready} onClick={() => void savePdf()}>
            {busy === 'save' ? '…' : <><UiIcon e="download" size={16} /> Guardar PDF</>}
          </button>
          <button className="btn ghost" disabled={!!busy || !ready} onClick={() => void openPdf()}>Abrir PDF A4</button>
          <button className="btn ghost" disabled={!!busy} onClick={() => void refresh()}>Actualizar</button>
          <button className="btn lg efr-new" onClick={onClose} autoFocus>{reprint ? 'Fechar' : 'Nova venda'}</button>
        </div>
      </div>
    </div>
  );
}
