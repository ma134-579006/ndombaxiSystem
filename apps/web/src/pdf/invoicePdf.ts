import { jsPDF } from 'jspdf';
import { formatKz } from '../format';
import QRCode from 'qrcode';
import type { DocumentIdentity, SaleDetail } from '../api/types';
import { buildInvoicePdf as buildA4 } from './invoicePdfA4';

/* ── Paleta SÓBRIA (enterprise) — igual à do Caixa, para o documento fiscal ser
   idêntico venha ele da Gestão ou do POS. Tinta escura, cinzentos, réguas finas
   e molduras a delimitar cada bloco (à imagem das faturas Primavera/AGT). ── */
const INK: [number, number, number] = [17, 24, 39];
const SUB: [number, number, number] = [92, 101, 116];
const LINE: [number, number, number] = [203, 210, 221];
const ZEBRA: [number, number, number] = [246, 248, 251];
const HEAD: [number, number, number] = [30, 38, 52];
const DANGER: [number, number, number] = [200, 40, 40];

const KZ = (n: number) => formatKz(n);

const DOC_LABEL: Record<string, string> = {
  FT: 'Fatura', FS: 'Fatura-Recibo', FR: 'Fatura-Recibo', NC: 'Nota de Crédito', ND: 'Nota de Débito',
};

/** Assinatura AGT (4 caracteres do hash nas posições 1, 11, 21, 31 — DP 71/25). */
function agtSignature(hash: string): string {
  if (!hash) return '';
  return [0, 10, 20, 30].map((i) => hash[i] ?? '').join('');
}

/**
 * PDF A4 de um documento fiscal EMITIDO (2ª via / reimpressão), com o mesmo
 * layout profissional do Caixa: cabeçalho com identidade + bloco do documento,
 * adquirente com moldura, tabela densa, resumo de impostos, TOTAL DO DOCUMENTO,
 * assinatura AGT, QR e rodapé.
 */
export async function buildInvoicePdf(sale: SaleDetail, identity?: DocumentIdentity | null): Promise<jsPDF> {
  // Formato A4 de referência (o mesmo da caixa). Sem info fiscal neste caminho:
  // nunca se afirma "programa validado" — só o controlo (hash).
  const doc = await buildA4({
    invoice: sale.invoice,
    identity,
    customerName: sale.customerName,
    operatorName: sale.cashierName,
    reprint: true,
    items: sale.items.map((it) => ({ code: it.productCode, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total })),
  });
  if (sale.status === 'A') {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    for (let p = 1; p <= doc.getNumberOfPages(); p++) {
      doc.setPage(p); doc.setTextColor(...DANGER); doc.setFont('helvetica', 'bold'); doc.setFontSize(64);
      doc.text('ANULADO', W / 2, H / 2, { align: 'center', angle: 30 });
    }
  }
  return doc;
}
export function invoiceFileName(sale: SaleDetail): string {
  const num = (sale.invoice.number || 'documento').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${num}.pdf`;
}

/**
 * Carrega o logótipo de forma ROBUSTA: decodifica QUALQUER formato (PNG/JPEG/
 * WEBP) via <img>+canvas e reexporta como PNG — o jsPDF aceita sempre — e devolve
 * as dimensões naturais para manter a proporção. Aceita data-URI (o caso comum) e
 * URL. Antes: `fetch({mode:'cors'})` falhava em logos remotas e o formato fixo
 * 'PNG' rejeitava JPEG → a fatura saía sem logótipo. Tolera falhar (devolve null).
 */
async function loadLogo(url: string): Promise<{ data: string; w: number; h: number } | null> {
  let src = url;
  if (!src.startsWith('data:')) {
    try {
      let res: Response;
      try { res = await fetch(url, { mode: 'cors' }); } catch { res = await fetch(url); }
      if (!res.ok) return null;
      const blob = await res.blob();
      src = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    } catch { return null; }
  }
  return await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 1;
        c.height = img.naturalHeight || 1;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
