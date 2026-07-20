import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity } from '../api/types';

export interface StorePosterArgs {
  /** Identidade fiscal da empresa (nome legal, NIF, logo, contactos). */
  identity?: DocumentIdentity | null;
  /** Nome comercial da loja online (brand_name das definições da loja). */
  storeName: string;
  /** Descrição / slogan curto da loja. */
  tagline?: string;
  /** Logótipo da loja (data URL ou URL). Cai para o da identidade se faltar. */
  logoUrl?: string;
  /** Link partilhável da loja. */
  storeLink: string;
  /** Cor primária da marca (hex). */
  primaryColor?: string;
  /** Contactos específicos da loja (caem para os da identidade). */
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
}

type RGB = [number, number, number];
const INK: RGB = [17, 24, 39];
const MUTED: RGB = [107, 114, 128];
const LIGHT: RGB = [243, 246, 251];

function hexToRgb(hex: string | undefined, fallback: RGB): RGB {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

/**
 * PDF VERDADEIRO (A4) do cartaz da loja online — gerado com jsPDF, NUNCA por
 * screenshot. Contém: logo, nome da empresa, nome da loja, QR em alta resolução,
 * URL, descrição, benefícios, como partilhar, contactos e rodapé profissional,
 * nas cores da marca.
 */
export async function buildStorePosterPdf(a: StorePosterArgs): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 46;
  const brand = hexToRgb(a.primaryColor, [37, 99, 235]);
  const empresa = a.identity?.companyName || a.identity?.brandName || a.storeName;
  const logoSrc = a.logoUrl || a.identity?.logoUrl || '';
  const phone = a.contactPhone || a.identity?.phone || '';
  const email = a.contactEmail || a.identity?.email || '';
  const addr = a.address || a.identity?.address || '';

  // ── Faixa de topo (cor da marca) ─────────────────────────────────────────
  doc.setFillColor(...brand);
  doc.rect(0, 0, W, 132, 'F');
  // acento mais escuro subtil por baixo
  doc.setFillColor(brand[0] * 0.82, brand[1] * 0.82, brand[2] * 0.82);
  doc.rect(0, 128, W, 4, 'F');

  let logoData: string | null = null;
  if (logoSrc) { try { logoData = await toDataUrl(logoSrc); } catch { /* opcional */ } }
  if (logoData) {
    // caixa branca arredondada para o logo
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, 34, 64, 64, 10, 10, 'F');
    try { doc.addImage(logoData, 'PNG', M + 6, 40, 52, 52, undefined, 'FAST'); } catch { /* opcional */ }
  }
  const tx = logoData ? M + 80 : M;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  doc.text(empresa.toUpperCase(), tx, 54, { charSpace: 0.4 });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24);
  doc.text(doc.splitTextToSize(a.storeName || 'A nossa loja online', W - tx - M)[0], tx, 82);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  const desc = (a.tagline && a.tagline.trim()) || 'Compre online — rápido, sem filas e com entrega em Angola.';
  doc.text(doc.splitTextToSize(desc, W - tx - M).slice(0, 2), tx, 102);

  // ── QR em alta resolução, dentro de cartão arredondado ───────────────────
  const qrBox = 236;
  const qrX = (W - qrBox) / 2;
  let y = 168;
  doc.setDrawColor(...brand); doc.setLineWidth(2.4);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(qrX, y, qrBox, qrBox + 46, 18, 18, 'FD');
  try {
    // width 1024 → QR nítido mesmo impresso em grande
    const qr = await QRCode.toDataURL(a.storeLink, { margin: 1, width: 1024, errorCorrectionLevel: 'M' });
    doc.addImage(qr, 'PNG', qrX + 18, y + 18, qrBox - 36, qrBox - 36, undefined, 'FAST');
  } catch { /* QR opcional */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
  doc.text('Digitalize para abrir a loja', W / 2, y + qrBox + 8, { align: 'center' });

  // URL numa "pílula" clara
  y += qrBox + 46 + 22;
  const url = a.storeLink;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11.5);
  const urlW = Math.min(doc.getTextWidth(url) + 28, W - 2 * M);
  doc.setFillColor(...LIGHT);
  doc.roundedRect((W - urlW) / 2, y - 15, urlW, 26, 13, 13, 'F');
  doc.setTextColor(...brand);
  doc.text(url, W / 2, y + 2, { align: 'center' });

  // ── Duas colunas: Benefícios | Como partilhar ────────────────────────────
  y += 40;
  const colGap = 26;
  const colW = (W - 2 * M - colGap) / 2;
  const leftX = M;
  const rightX = M + colW + colGap;

  const section = (x: number, title: string, items: string[]) => {
    let yy = y;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...INK);
    doc.text(title, x, yy);
    // sublinhado curto na cor da marca
    doc.setDrawColor(...brand); doc.setLineWidth(2); doc.line(x, yy + 6, x + 26, yy + 6);
    yy += 24;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(55, 65, 81);
    for (const it of items) {
      doc.setFillColor(...brand); doc.circle(x + 3, yy - 3, 2.1, 'F');
      const lines = doc.splitTextToSize(it, colW - 16);
      doc.text(lines, x + 12, yy);
      yy += 14 * lines.length + 6;
    }
    return yy;
  };

  const benefits = [
    'Vendas 24 horas por dia, sem filas de espera.',
    'Entrega em Angola combinada com o cliente.',
    'Fatura certificada AGT em cada compra.',
    'Pagamento por referência (Multicaixa Express).',
    'Compra simples pelo telemóvel.',
  ];
  const share = [
    'Envie o link por WhatsApp e redes sociais.',
    'Imprima este cartaz e cole na loja física.',
    'Coloque o QR em cartões, faturas e montras.',
    'Peça ao cliente para apontar a câmara ao QR.',
  ];
  const yL = section(leftX, 'Benefícios da loja online', benefits);
  const yR = section(rightX, 'Como partilhar', share);
  y = Math.max(yL, yR) + 8;

  // ── Contactos ────────────────────────────────────────────────────────────
  const contacts = [
    phone ? `Telefone: ${phone}` : '',
    email ? `Email: ${email}` : '',
    addr ? `Morada: ${addr}` : '',
  ].filter(Boolean);
  if (contacts.length) {
    doc.setFillColor(...LIGHT);
    const boxH = 22 + contacts.length * 15;
    doc.roundedRect(M, y, W - 2 * M, boxH, 12, 12, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text('Contactos', M + 14, y + 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...MUTED);
    let cy = y + 34;
    for (const c of contacts) { doc.text(c, M + 14, cy); cy += 15; }
  }

  // ── Rodapé profissional ──────────────────────────────────────────────────
  const fy = H - 44;
  doc.setDrawColor(...brand); doc.setLineWidth(1.5); doc.line(M, fy, W - M, fy);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...brand);
  doc.text(empresa, M, fy + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(170, 178, 190);
  doc.text('Loja online segura · Gerado por Ndombaxi System', W - M, fy + 18, { align: 'right' });

  return doc;
}

/** Nome de ficheiro seguro para o PDF do cartaz. */
export function posterFileName(storeName: string): string {
  const slug = (storeName || 'loja').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'loja';
  return `loja-online-${slug}.pdf`;
}
