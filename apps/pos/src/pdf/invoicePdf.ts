// jsPDF (~400 KB) é carregado DINAMICAMENTE na 1.ª geração de PDF — fora do
// caminho crítico do arranque do caixa (importante em ligações 3G/4G).
import type { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity, EmittedInvoice, ReceiptFiscalInfo } from '../api/types';

export interface InvoicePdfArgs {
  invoice: EmittedInvoice;
  identity?: DocumentIdentity | null;
  info?: ReceiptFiscalInfo | null;
  customerName?: string | null;
  customerNif?: string | null;
  operatorName?: string | null;
  items?: { code?: string; description: string; quantity: number; unitPrice: number; total: number; ivaRate?: number; net?: number; iva?: number; exemptionCode?: string | null; discount?: number }[];
  provisional?: boolean;
  /** 2.ª via (reimpressão). */
  reprint?: boolean;
  /** Meios de pagamento para o bloco "Meio de Pagamento". */
  payments?: { label: string; amount: number }[];
}

const INK: [number, number, number] = [17, 17, 17];
const SUB: [number, number, number] = [70, 70, 70];

/** Assinatura AGT (4 caracteres do hash nas posições 1, 11, 21, 31 — DP 71/25). */
function agtSignature(hash: string): string {
  if (!hash) return '';
  return [0, 10, 20, 30].map((i) => hash[i] ?? '').join('');
}

const n2 = (v: number) => v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor por extenso em português (kwanzas e cêntimos), como nas Observações do documento de referência. */
function extensoKz(v: number): string {
  const U = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete', 'dezoito', 'dezanove'];
  const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = (n: number): string => {
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100), r = n % 100;
    const parts: string[] = [];
    if (c) parts.push(C[c]);
    if (r) parts.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ` e ${U[r % 10]}` : ''));
    return parts.join(' e ');
  };
  const inteiro = (n: number): string => {
    if (n === 0) return 'zero';
    // Grupos (milhares de milhão, milhões, milhares, unidades); "e" antes do
    // último grupo quando é < 100 ou centena redonda (mil e cinco, mil e duzentos).
    const g: { q: number; tx: string }[] = [];
    let rest = n;
    for (const [base, sing, plur] of [[1e9, 'mil milhões', 'mil milhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil']] as [number, string, string][]) {
      const q = Math.floor(rest / base);
      if (!q) continue;
      rest %= base;
      g.push({ q, tx: base === 1e3 ? (q === 1 ? 'mil' : `${ate999(q)} mil`) : `${q === 1 ? 'um' : ate999(q)} ${q === 1 ? sing : plur}` });
    }
    if (rest) g.push({ q: rest, tx: ate999(rest) });
    if (g.length === 1) return g[0].tx;
    const last = g[g.length - 1];
    return g.slice(0, -1).map((x) => x.tx).join(' ') + (last.q < 100 || last.q % 100 === 0 ? ' e ' : ' ') + last.tx;
  };
  const total = Math.round(Math.abs(v) * 100);
  const kz = Math.floor(total / 100), ct = total % 100;
  const kzTx = `${inteiro(kz)} ${kz >= 1e6 && kz % 1e6 === 0 ? 'de ' : ''}${kz === 1 ? 'kwanza' : 'kwanzas'}`;
  return ct ? `${kzTx} e ${inteiro(ct)} ${ct === 1 ? 'cêntimo' : 'cêntimos'}` : kzTx;
}

/**
 * FATURA A4 no formato do documento de referência (estudado só em leitura;
 * desenho e código próprios): logótipo + dados da empresa à esquerda e cliente
 * à direita; "Factura n.º …" com "Original"/"2.ª via"; faixa Data de Emissão /
 * Vencimento / Contribuinte / V/ Ref.; Observações; tabela Código / Descrição /
 * Pr. Unitário / Uni. / Qtd. / IVA / Total; em baixo, à esquerda o quadro
 * Taxa / Incidência / IVA (+ motivos de isenção) e o Meio de Pagamento, à
 * direita o Sumário e o Total; rodapé "Página x/y" e "{hash}-Processado por
 * programa validado n.º …" (só com certificado configurado).
 */
export async function buildInvoicePdf(a: InvoicePdfArgs): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const { invoice, identity, info, customerName, customerNif, items, provisional, reprint, payments } = a;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 46;
  const usable = W - 2 * M;
  const empresa = identity?.companyName || identity?.brandName || 'Empresa';
  const designation = provisional ? 'Comprovativo' : ({ FT: 'Factura', FR: 'Factura-Recibo', FS: 'Factura-Recibo', NC: 'Nota de Crédito', ND: 'Nota de Débito', RC: 'Recibo' } as Record<string, string>)[invoice.number.split(' ')[0]] ?? 'Documento';
  const issue = new Date();
  const isoDate = `${issue.getFullYear()}-${String(issue.getMonth() + 1).padStart(2, '0')}-${String(issue.getDate()).padStart(2, '0')}`;
  const certOk = !!info?.softwareCertificateNumber && String(info.softwareCertificateNumber) !== '0';

  // ── Cabeçalho: logótipo + empresa (esq.) e cliente (dir.) ──
  let y = 48;
  if (identity?.logoUrl) {
    try {
      const logo = await loadLogo(identity.logoUrl);
      if (logo) {
        const scale = Math.min(70 / logo.w, 62 / logo.h);
        doc.addImage(logo.data, 'PNG', M, y, Math.max(1, logo.w * scale), Math.max(1, logo.h * scale), undefined, 'FAST');
        y += Math.max(1, logo.h * scale) + 8;
      }
    } catch { /* logo opcional */ }
  }
  const leftW = usable * 0.55;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  for (const ln of doc.splitTextToSize(empresa, leftW)) { doc.text(String(ln), M, y); y += 12; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  for (const ln of (identity?.address ? identity.address.split(/\n|,\s*/).map((s) => s.trim()).filter(Boolean) : [])) { doc.text(ln, M, y); y += 11.5; }
  const kv = (k: string, v: string) => { doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, M, y); const w = doc.getTextWidth(`${k}: `); doc.setFont('helvetica', 'normal'); doc.text(v, M + w, y); y += 11.5; };
  if (identity?.nif) kv('Contribuinte', identity.nif);
  if (identity?.email) kv('E-mail', identity.email);
  if (identity?.phone) kv('Tel', identity.phone);
  // Cliente à direita, à altura do bloco da empresa
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  const cx = M + usable * 0.6;
  let cy = 118;
  for (const ln of doc.splitTextToSize(customerName || 'Consumidor Final', usable * 0.4)) { doc.text(String(ln), cx, cy); cy += 12; }
  if (customerNif) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Contribuinte: ${customerNif}`, cx, cy); cy += 11.5; }

  // ── Título + via ──
  y = Math.max(y, cy) + 22;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(14);
  doc.text(`${designation} n.º ${invoice.number}`, M, y);
  doc.setFontSize(9);
  doc.text(provisional ? 'Provisório' : reprint ? '2.ª Via' : 'Original', W - M, y, { align: 'right' });
  y += 5; doc.setDrawColor(0); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);

  // ── Faixa de dados: Data de Emissão | Vencimento | Contribuinte | V/ Ref. ──
  y += 16;
  const metaCols = [['Data de Emissão', isoDate], ['Vencimento', isoDate], ['Contribuinte', customerNif || 'Consumidor Final'], ['V/ Ref.', invoice.number]];
  const mw = usable / 4;
  doc.setFontSize(8.6);
  metaCols.forEach(([k, v], i) => {
    const x = M + i * mw;
    doc.setTextColor(...SUB); doc.text(k, x, y);
    doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(x, y + 5, x + mw - 14, y + 5);
    doc.setTextColor(...INK); doc.text(String(v), x, y + 20);
  });
  y += 32; doc.setLineWidth(0.5); doc.line(M, y, W - M, y);
  y += 14;
  {
    // Como no documento de referência: total por extenso e a menção de que os
    // bens/serviços foram colocados à disposição na data do documento (+ legenda própria).
    const obsText = [
      provisional ? '' : `Total: ${extensoKz(invoice.grossTotal)}.`,
      provisional ? '' : 'Os bens/serviços foram colocados à disposição do adquirente na data do documento.',
      info?.receiptLegend ?? '',
    ].filter(Boolean).join(' ');
    if (obsText) {
      doc.setFont('helvetica', 'bold'); doc.text('Observações:', M, y);
      doc.setFont('helvetica', 'normal');
      const lw = doc.getTextWidth('Observações: ');
      const obs = doc.splitTextToSize(obsText, usable - lw);
      obs.forEach((ln: string, i: number) => doc.text(String(ln), M + (i ? 0 : lw), y + i * 11));
      y += obs.length * 11 + 8;
    }
  }

  // ── Tabela de artigos ──
  y += 10;
  const cols = [
    { h: 'Código', w: 1.5, al: 'left' as const }, { h: 'Descrição', w: 3.6, al: 'left' as const },
    { h: 'Pr. Unitário', w: 1.4, al: 'right' as const }, { h: 'Uni.', w: 0.6, al: 'center' as const },
    { h: 'Qtd.', w: 0.6, al: 'center' as const }, { h: 'IVA', w: 0.8, al: 'right' as const }, { h: 'Total', w: 1.4, al: 'right' as const },
  ];
  const ws = cols.reduce((s, c) => s + c.w, 0);
  const cw = cols.map((c) => (c.w / ws) * usable);
  const cxs: number[] = []; { let acc = M; for (const w of cw) { cxs.push(acc); acc += w; } }
  const tx = (i: number) => (cols[i].al === 'right' ? cxs[i] + cw[i] - 3 : cols[i].al === 'center' ? cxs[i] + cw[i] / 2 : cxs[i] + 2);
  const head = () => {
    doc.setDrawColor(0); doc.setLineWidth(0.9); doc.line(M, y - 11, W - M, y - 11);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.8); doc.setTextColor(...INK);
    cols.forEach((c, i) => doc.text(c.h, tx(i), y, { align: c.al }));
    y += 6; doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 14;
  };
  head();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8);
  const exempt = new Set<string>();
  for (const it of items ?? []) {
    const desc = doc.splitTextToSize(it.description, cw[1] - 6);
    const rowH = Math.max(16, desc.length * 10.5 + 4);
    if (y + rowH > H - 230) { doc.addPage(); y = 60; head(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8); }
    const rate = it.ivaRate ?? (invoice.netTotal > 0 ? Math.round((invoice.ivaTotal / invoice.netTotal) * 100) : 0);
    if (rate === 0) exempt.add(it.exemptionCode ? `${it.exemptionCode}` : 'Isento de IVA');
    doc.text(String(it.code ?? ''), tx(0), y, { align: 'left' });
    desc.forEach((ln: string, k: number) => doc.text(String(ln), tx(1), y + k * 10.5));
    doc.text(`${n2(it.unitPrice)} Kz`, tx(2), y, { align: 'right' });
    doc.text('Uni', tx(3), y, { align: 'center' });
    doc.text(String(it.quantity), tx(4), y, { align: 'center' });
    doc.text(`${rate}%${rate === 0 ? ' (1)' : ''}`, tx(5), y, { align: 'right' });
    doc.text(`${n2(it.total + (it.discount ?? 0))} Kz`, tx(6), y, { align: 'right' });
    y += rowH;
  }
  doc.setLineWidth(0.9); doc.line(M, y - 6, W - M, y - 6);

  // ── Rodapé fiscal: quadro de IVA + pagamento (esq.) · Sumário + Total (dir.) ──
  let by = Math.max(y + 30, H - 210);
  if (by + 120 > H - 40) { doc.addPage(); by = 80; }
  const lw = usable * 0.5, lx = M, rx = M + usable * 0.6, rw = usable * 0.4;
  const rowsByRate = new Map<number, { base: number; iva: number }>();
  for (const it of items ?? []) {
    if (it.ivaRate == null || it.net == null) continue;
    const r = rowsByRate.get(it.ivaRate) ?? { base: 0, iva: 0 }; r.base += it.net; r.iva += it.iva ?? 0; rowsByRate.set(it.ivaRate, r);
  }
  const taxRows = rowsByRate.size ? [...rowsByRate.entries()].sort((p, q) => q[0] - p[0]) : [[invoice.netTotal > 0 ? Math.round((invoice.ivaTotal / invoice.netTotal) * 100) : 0, { base: invoice.netTotal, iva: invoice.ivaTotal }] as [number, { base: number; iva: number }]];
  const block = (title: string, x: number, w: number, yy: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(title, x, yy);
    doc.setLineWidth(0.8); doc.line(x, yy + 4, x + w, yy + 4);
  };
  // Taxa | Incidência | IVA
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Taxa', lx, by); doc.text('Incidência', lx + lw * 0.62, by, { align: 'right' }); doc.text('IVA', lx + lw, by, { align: 'right' });
  doc.setLineWidth(0.8); doc.line(lx, by + 4, lx + lw, by + 4);
  let ly = by + 16; doc.setFont('helvetica', 'normal');
  for (const [rate, v] of taxRows) {
    doc.text(`${rate}%`, lx, ly); doc.text(`${n2(v.base)} Kz`, lx + lw * 0.62, ly, { align: 'right' }); doc.text(`${n2(v.iva)} Kz`, lx + lw, ly, { align: 'right' }); ly += 11;
  }
  if (exempt.size) { doc.setFontSize(7.5); doc.text(`(1) ${[...exempt].join(' · ')}`, lx, ly); ly += 10; doc.setFontSize(9); }
  ly += 10;
  if (payments?.length) {
    block('Meio de Pagamento', lx, lw, ly); ly += 16; doc.setFont('helvetica', 'normal');
    for (const p of payments) { doc.text(p.label, lx, ly); doc.text(`${n2(p.amount)} Kz`, lx + lw, ly, { align: 'right' }); ly += 11; }
  }
  // Sumário
  block('Sumário', rx, rw, by);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('S/IVA', rx, by + 16); doc.text(`${n2(invoice.netTotal)} Kz`, rx + rw, by + 16, { align: 'right' });
  doc.text('IVA', rx, by + 28); doc.text(`${n2(invoice.ivaTotal)} Kz`, rx + rw, by + 28, { align: 'right' });
  doc.setLineWidth(0.9); doc.line(rx, by + 52, rx + rw, by + 52);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
  doc.text('Total', rx, by + 68); doc.text(`${n2(invoice.grossTotal)} Kz`, rx + rw, by + 68, { align: 'right' });

  // ── QR de verificação (acima do sumário à direita, quando há hash) ──
  if (!provisional && invoice.hash) {
    try {
      const qrData = invoice.feQr && identity?.nif
        ? `https://quiosqueagt.minfin.gov.ao/facturacao-eletronica/consultar-fe?emissor=${encodeURIComponent(identity.nif)}&document=${invoice.number.replace(/ /g, '%20')}`
        : [empresa, invoice.number, identity?.nif ? `NIF:${identity.nif}` : '', `Total:${invoice.grossTotal}`, `IVA:${invoice.ivaTotal}`, isoDate, `H:${invoice.hash.slice(0, 16)}`].filter(Boolean).join('|');
      const qr = await QRCode.toDataURL(qrData, { margin: 1, width: 200 });
      doc.addImage(qr, 'PNG', rx + rw - 64, by + 80, 64, 64, undefined, 'FAST');
    } catch { /* QR opcional */ }
  }

  // ── Rodapé de todas as páginas ──
  const sig = agtSignature(invoice.hash);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.4); doc.setTextColor(...INK);
    doc.text(`Página ${p}/${pages}`, M, H - 36);
    const proc = provisional ? 'Comprovativo provisório — sem validade fiscal' : certOk
      ? `${sig ? `${sig}-` : ''}Processado por programa validado n.º ${info!.softwareCertificateNumber}`
      : sig ? `Controlo (Hash): ${sig}` : '';
    if (proc) doc.text(proc, W - M, H - 36, { align: 'right' });
    for (const [i, f] of (info?.fields ?? []).entries()) doc.text(`${f.label}: ${f.value}`, M, H - 50 - i * 10);
    // Linha vertical na margem esquerda (como na referência): documento
    // eletrónico, momento de geração (UTC) e o hash do documento.
    if (!provisional) {
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      doc.setFontSize(6.6); doc.setTextColor(...SUB);
      doc.text(`Documento Eletrónico LPS Vendas - ${ts} UTC${invoice.hash ? ` · ${invoice.hash.slice(0, 40)}` : ''}`, M - 22, H - 120, { angle: 90 });
      doc.setTextColor(...INK);
    }
  }
  return doc;
}
/** Nome de ficheiro limpo para a fatura. */
export function invoiceFileName(invoice: EmittedInvoice): string {
  return `Fatura-${invoice.number.replace(/[^\w-]/g, '_')}.pdf`;
}

/**
 * Carrega o logótipo de forma ROBUSTA: decodifica QUALQUER formato (PNG/JPEG/
 * WEBP) via <img>+canvas e reexporta como PNG — o jsPDF aceita sempre — e devolve
 * as dimensões naturais para manter a proporção. Aceita data-URI (o caso comum: a
 * logo é gravada em base64) e URL. O bug anterior: `fetch({mode:'cors'})` falhava
 * em logos remotas e o formato fixo 'PNG' rejeitava logos JPEG → a fatura saía
 * sem logótipo. Tolera falhar (devolve null; nunca rebenta a fatura).
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
