import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity, ServiceOrderDetail } from '../api/types';

const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];
const LIGHT: [number, number, number] = [243, 246, 251];

const KZ = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const FUEL_LABEL: Record<string, string> = { EMPTY: 'Vazio', LOW: '1/4', HALF: '1/2', HIGH: '3/4', FULL: 'Cheio' };
const MIN_LABEL = (m?: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}` : `${m} min`);

/**
 * FOLHA DE OBRA (A4) da Mecânica — documento profissional de receção e trabalho:
 * dados da viatura, KM, combustível, estado, checklist, avaria/diagnóstico, peças
 * e mão-de-obra, tempos, garantia, fotos e assinatura do cliente. Gerado com jsPDF
 * (biblioteca PDF), nunca screenshot.
 */
export async function buildWorkOrderPdf(detail: ServiceOrderDetail, identity?: DocumentIdentity | null): Promise<jsPDF> {
  const o = detail.order;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 46;
  const brand: [number, number, number] = [37, 48, 232]; // índigo da marca (design system)
  const empresa = identity?.companyName || identity?.brandName || 'Oficina';
  const isDevice = (o.equipment_type ?? '').toUpperCase() !== 'VEHICLE';
  const docTitle = isDevice ? 'FOLHA DE SERVIÇO' : 'FOLHA DE OBRA';

  // ── Cabeçalho ──
  let y = 52;
  if (identity?.logoUrl) {
    try { const l = await toDataUrl(identity.logoUrl); if (l) doc.addImage(l, 'PNG', M, y - 16, 50, 50, undefined, 'FAST'); } catch { /* opcional */ }
  }
  const tx = identity?.logoUrl ? M + 64 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...INK);
  doc.text(empresa, tx, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  if (identity?.nif) doc.text(`NIF: ${identity.nif}`, tx, y + 15);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...brand);
  doc.text(docTitle, W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text(o.number, W - M, y + 16, { align: 'right' });
  doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(new Date().toLocaleString('pt-PT'), W - M, y + 30, { align: 'right' });

  y += 46;
  doc.setDrawColor(...brand); doc.setLineWidth(2); doc.line(M, y, W - M, y);
  y += 18;

  // ── Viatura / cliente (duas caixas) ──
  const half = (W - 2 * M - 14) / 2;
  const boxTop = y;
  const kv = (x: number, w: number, title: string, rows: [string, string][]) => {
    let yy = boxTop;
    const h = 22 + rows.length * 15;
    doc.setFillColor(...LIGHT); doc.roundedRect(x, yy, w, h, 8, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    doc.text(title, x + 12, yy + 17);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    yy += 33;
    for (const [k, v] of rows) {
      doc.setTextColor(...MUTED); doc.text(k, x + 12, yy);
      doc.setTextColor(...INK); doc.text(doc.splitTextToSize(v || '—', w - 90)[0] ?? '—', x + 88, yy);
      yy += 15;
    }
    return h;
  };
  const vehRows: [string, string][] = [
    ['Viatura', o.equipment_label || '—'],
    ['Matrícula/ref.', o.equipment_ref || '—'],
    ['Quilometragem', o.km_in != null ? `${Number(o.km_in).toLocaleString('pt-PT')} km` : '—'],
    ['Combustível', o.fuel_level ? (FUEL_LABEL[o.fuel_level] ?? o.fuel_level) : '—'],
  ];
  if (isDevice) {
    // Aparelho: substitui as linhas de viatura por IMEI/estado (sem KM/combustível).
    vehRows.length = 0;
    vehRows.push(['Aparelho', o.equipment_label || 'sem etiqueta']);
    vehRows.push(['IMEI/serie', o.imei || o.equipment_ref || '-']);
    vehRows.push(['Estado', o.status]);
    vehRows.push(['Recebido', o.received_at ? new Date(o.received_at).toLocaleDateString('pt-PT') : '-']);
  }
  const cliRows: [string, string][] = [
    ['Cliente', o.customer_name || 'Consumidor final'],
    ['Telefone', o.customer_phone || '—'],
    ['Técnico', o.assigned_to || '—'],
    ['Estado', o.status],
  ];
  const h1 = kv(M, half, isDevice ? 'Aparelho' : 'Viatura', vehRows);
  const h2 = kv(M + half + 14, half, 'Cliente', cliRows);
  y = boxTop + Math.max(h1, h2) + 16;

  // ── Avaria / diagnóstico ──
  const para = (title: string, text: string) => {
    if (!text) return;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    doc.text(title, M, y); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(55, 65, 81);
    const lines = doc.splitTextToSize(text, W - 2 * M);
    doc.text(lines, M, y); y += lines.length * 12 + 8;
  };
  para('Avaria relatada', o.problem || '');
  para('Diagnóstico', o.diagnosis || '');
  para(isDevice ? 'Estado físico do aparelho' : 'Estado do veículo', o.vehicle_state || '');

  // ── Checklist ──
  if (o.checklist && o.checklist.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    doc.text('Checklist de inspeção', M, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const cols = 3; const cw = (W - 2 * M) / cols;
    let i = 0;
    for (const c of o.checklist) {
      const col = i % cols; const x = M + col * cw;
      const mark = c.ok === true ? '[OK]' : c.ok === false ? '[!]' : '[ ]';
      doc.setTextColor(c.ok === true ? 22 : c.ok === false ? 200 : 120, c.ok === true ? 163 : c.ok === false ? 60 : 120, c.ok === true ? 74 : c.ok === false ? 60 : 120);
      doc.text(mark, x, y);
      doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(c.label + (c.note ? ` — ${c.note}` : ''), cw - 30)[0] ?? c.label, x + 22, y);
      if (col === cols - 1) y += 15;
      i++;
    }
    if (o.checklist.length % cols !== 0) y += 15;
    y += 8;
  }

  // ── Peças e mão-de-obra ──
  if (detail.items.length) {
    if (y > H - 160) { doc.addPage(); y = 52; }
    const usable = W - 2 * M;
    const colX = [M, M + usable * 0.58, M + usable * 0.72, M + usable * 0.86];
    doc.setFillColor(...INK); doc.rect(M, y - 13, usable, 22, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
    doc.text('Descrição', colX[0] + 8, y + 1);
    doc.text('Tipo', colX[1], y + 1);
    doc.text('Qtd', colX[2], y + 1, { align: 'right' });
    doc.text('Total', M + usable - 8, y + 1, { align: 'right' });
    y += 22;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const KIND: Record<string, string> = { PART: 'Peça', LABOR: 'Mão-de-obra', SERVICE: 'Serviço' };
    let alt = false; let total = 0;
    for (const it of detail.items) {
      if (y > H - 120) { doc.addPage(); y = 52; }
      if (alt) { doc.setFillColor(...LIGHT); doc.rect(M, y - 12, usable, 20, 'F'); } alt = !alt;
      const line = Number(it.unit_price) * Number(it.quantity); total += line;
      doc.setTextColor(30, 36, 46);
      doc.text(doc.splitTextToSize(it.description, usable * 0.55)[0] ?? it.description, colX[0] + 8, y + 2);
      doc.setTextColor(...MUTED); doc.text(KIND[it.kind] ?? it.kind, colX[1], y + 2);
      doc.setTextColor(30, 36, 46);
      doc.text(String(Number(it.quantity)), colX[2], y + 2, { align: 'right' });
      doc.text(KZ(line), M + usable - 8, y + 2, { align: 'right' });
      y += 20;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text('Total', M + usable - 120, y + 4);
    doc.text(KZ(Number(o.total) || total), M + usable - 8, y + 4, { align: 'right' });
    y += 24;
  }

  // ── Tempos + garantia ──
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  const meta = [
    `Tempo estimado: ${MIN_LABEL(o.est_minutes)}`,
    `Tempo realizado: ${MIN_LABEL(o.actual_minutes)}`,
    o.warranty_days ? `Garantia: ${o.warranty_days} dias${o.warranty_until ? ` (até ${new Date(o.warranty_until).toLocaleDateString('pt-PT')})` : ''}` : 'Sem garantia',
  ];
  doc.text(meta.join('     ·     '), M, y); y += 20;

  // ── Fotos (miniaturas) ──
  if (o.photos && o.photos.length) {
    if (y > H - 130) { doc.addPage(); y = 52; }
    const sz = 78; let x = M;
    for (const p of o.photos.slice(0, 6)) {
      if (x + sz > W - M) { x = M; y += sz + 8; }
      if (y > H - 110) { doc.addPage(); y = 52; x = M; }
      try { doc.addImage(p.url, 'JPEG', x, y, sz, sz, undefined, 'FAST'); } catch { /* ignora foto inválida */ }
      x += sz + 8;
    }
    y += sz + 14;
  }

  // ── Assinatura ──
  if (y > H - 110) { doc.addPage(); y = 52; }
  y = Math.max(y, H - 120);
  doc.setDrawColor(200, 206, 218); doc.setLineWidth(0.8);
  if (o.signature) {
    try { doc.addImage(o.signature, 'PNG', M, y - 40, 150, 46, undefined, 'FAST'); } catch { /* opcional */ }
  }
  doc.line(M, y + 10, M + 200, y + 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text('Assinatura do cliente', M, y + 24);

  // ── QR da ordem (referência/consulta rápida) ──
  try {
    const qrData = [`OS ${o.number}`, empresa, o.imei ? `IMEI:${o.imei}` : (o.equipment_ref || ''), o.customer_name || '']
      .filter(Boolean).join(' | ');
    const qr = await QRCode.toDataURL(qrData, { margin: 1, width: 240 });
    const qs = 60;
    doc.addImage(qr, 'PNG', W - M - qs, y - 44, qs, qs, undefined, 'FAST');
    doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(o.number, W - M - qs / 2, y + 24, { align: 'center' });
  } catch { /* QR opcional */ }

  // ── Rodapé ──
  const foot = [identity?.address, [identity?.phone, identity?.email].filter(Boolean).join(' · ')].filter(Boolean);
  let fy = H - 34;
  doc.setDrawColor(...brand); doc.setLineWidth(1); doc.line(M, fy - 8, W - M, fy - 8);
  for (const line of foot) { doc.text(String(line), W / 2, fy, { align: 'center' }); fy += 12; }

  return doc;
}

export function workOrderFileName(o: ServiceOrderDetail['order']): string {
  const n = (o.number || 'folha-obra').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `folha-obra-${n}.pdf`;
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
