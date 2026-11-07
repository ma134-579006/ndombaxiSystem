/**
 * Impressão TÉRMICA DIRETA (ESC/POS via WebUSB) — sem drivers.
 *
 * Porquê: o `window.print()` depende do Windows ter o driver da impressora
 * instalado e escolhido no diálogo; muitas térmicas chinesas nem trazem driver
 * ("não encontra a impressora conectada"). O WebUSB fala USB DIRETO com a
 * impressora em ESC/POS (a língua nativa das térmicas) — não precisa de
 * driver nenhum. Fluxo: emparelhar UMA vez (o navegador pede permissão) →
 * a partir daí o botão Imprimir sai direto e corta o papel.
 *
 * Se não houver impressora emparelhada/compatível, o chamador cai no
 * `window.print()` de sempre (nada se perde).
 */

// Tipos mínimos do WebUSB (o lib.dom nem sempre os traz).
interface UsbEndpoint { direction: 'in' | 'out'; endpointNumber: number }
interface UsbAlternate { interfaceClass: number; endpoints: UsbEndpoint[] }
interface UsbInterface { interfaceNumber: number; alternates: UsbAlternate[] }
interface UsbConfiguration { configurationValue: number; interfaces: UsbInterface[] }
interface UsbDevice {
  vendorId: number; productId: number; productName?: string;
  opened: boolean; configuration: UsbConfiguration | null; configurations: UsbConfiguration[];
  open(): Promise<void>; close(): Promise<void>;
  selectConfiguration(v: number): Promise<void>;
  claimInterface(n: number): Promise<void>; releaseInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<{ status: string }>;
}
interface Usb {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: Array<{ classCode?: number; vendorId?: number }> }): Promise<UsbDevice>;
}

const LS_KEY = 'ndombaxi.pos.usbprinter';

/** WebUSB disponível neste navegador/contexto (Chrome/Edge, https ou localhost)? */
export function rawPrintSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

function usb(): Usb {
  return (navigator as Navigator & { usb: Usb }).usb;
}

/** Vendors habituais de térmicas (Epson, Bixolon, Star, XPrinter/genéricas…). */
const THERMAL_VENDORS = [0x04b8, 0x0419, 0x0519, 0x0416, 0x0483, 0x0dd4, 0x1504, 0x0525, 0x28e9, 0x6868, 0x0fe6, 0x1a86, 0x067b];

/**
 * Emparelha (uma vez) a impressora: abre o seletor do navegador filtrado a
 * impressoras (classe USB 7) e aos vendors térmicos conhecidos. Guarda a
 * identificação para reconectar sozinho nas impressões seguintes.
 */
export async function pairPrinter(): Promise<{ name: string } | null> {
  if (!rawPrintSupported()) throw new Error('Este navegador não suporta impressão direta (use Chrome/Edge).');
  const dev = await usb().requestDevice({
    filters: [{ classCode: 7 }, ...THERMAL_VENDORS.map((vendorId) => ({ vendorId }))],
  }).catch(() => null);
  if (!dev) return null; // utilizador cancelou
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ vendorId: dev.vendorId, productId: dev.productId, name: dev.productName ?? 'Impressora térmica' }));
  } catch { /* privado */ }
  return { name: dev.productName ?? 'Impressora térmica' };
}

/** Impressora já emparelhada neste dispositivo (nome para a UI), se houver. */
export function pairedPrinterName(): string | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw).name as string) ?? 'Impressora térmica' : null;
  } catch { return null; }
}

export function forgetPrinter(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignora */ }
}

async function getPairedDevice(): Promise<UsbDevice | null> {
  if (!rawPrintSupported()) return null;
  let saved: { vendorId: number; productId: number } | null = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'); } catch { /* ignora */ }
  const devices = await usb().getDevices();
  if (!devices.length) return null;
  if (saved) {
    const match = devices.find((d) => d.vendorId === saved!.vendorId && d.productId === saved!.productId);
    if (match) return match;
  }
  // Sem registo (ou trocou de porta): usa a primeira impressora autorizada.
  return devices[0] ?? null;
}

/** Encontra interface+endpoint OUT (preferindo a classe 7 = impressora). */
function findOut(dev: UsbDevice): { ifaceNumber: number; endpoint: number } | null {
  const cfg = dev.configuration ?? dev.configurations[0];
  if (!cfg) return null;
  let fallback: { ifaceNumber: number; endpoint: number } | null = null;
  for (const iface of cfg.interfaces) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e) => e.direction === 'out');
      if (!out) continue;
      const found = { ifaceNumber: iface.interfaceNumber, endpoint: out.endpointNumber };
      if (alt.interfaceClass === 7) return found;
      fallback = fallback ?? found;
    }
  }
  return fallback;
}

/* ── Codificação: PT-PT para CP860 (tabela portuguesa das térmicas) ── */
const CP860: Record<string, number> = {
  'ç': 0x87, 'Ç': 0x80, 'ã': 0x84, 'Ã': 0x8e, 'á': 0xa0, 'Á': 0x86, 'à': 0x85, 'À': 0x91,
  'â': 0x83, 'Â': 0x8f, 'é': 0x82, 'É': 0x90, 'ê': 0x88, 'Ê': 0x89, 'í': 0xa1, 'Í': 0x8b,
  'ó': 0xa2, 'Ó': 0x9f, 'õ': 0x94, 'Õ': 0x99, 'ô': 0x93, 'Ô': 0x8c, 'ú': 0xa3, 'Ú': 0x96,
  'ü': 0x81, 'º': 0xa7, 'ª': 0xa6, '·': 0xfa, '€': 0x45,
};
function encodePt(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) { out.push(code); continue; }
    if (CP860[ch] != null) { out.push(CP860[ch]); continue; }
    // Desconhecido → remove acento; senão '?'
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out.push(plain.charCodeAt(0) < 0x80 ? plain.charCodeAt(0) : 0x3f);
  }
  return out;
}

/** Documento de recibo estruturado (o ReceiptModal preenche). */
export interface RawReceipt {
  company?: string | null;
  meta?: string | null;      // NIF · morada (compatibilidade)
  /** Linhas do cabeçalho centradas (morada, NIF, e-mail, telefones) — uma por linha. */
  headerLines?: string[];
  /** Slogan/mensagem da empresa (a negrito, por baixo do nome). */
  slogan?: string | null;
  title: string;             // nº do documento
  date: string;
  /** "Original" ou "Segunda Via cf. Original". */
  via?: string | null;
  customer?: string | null;
  customerNif?: string | null;
  operator?: string | null;
  items?: Array<{ code?: string; description: string; quantity: number; unitPrice: number; total: number; discount?: number; discountRate?: number; ivaRate?: number; exempt?: boolean }>;
  netTotal: number; ivaTotal: number; grossTotal: number;
  hash?: string | null;
  /** Designação do documento (Factura, Factura-Recibo, Nota de Crédito…). */
  docTitle?: string | null;
  /** IVA discriminado por taxa (DP 312/18). */
  taxRows?: Array<{ label: string; base: number; iva: number; rate?: number }>;
  /** Motivos de isenção dos artigos isentos ("M12 …"). */
  exemptions?: string[];
  /** Meios de pagamento (Numerário 5.000,00 …) e troco. */
  payments?: Array<{ label: string; amount: number }>;
  change?: number | null;
  /** "Processado por programa validado n.º …" (com o hash à frente). */
  processedBy?: string | null;
  /** QR da AGT (Facturação Electrónica) — impresso no fim do talão. */
  qr?: string | null;
  legends?: string[];
  footer?: string[];
}

const num = (n: number) => n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kz = (n: number) => `${num(n)} Kz`;

/**
 * QR nativo da térmica (GS ( k, modelo 2, correcção M). A impressora desenha-o
 * sozinha a partir do texto — sem imagem, nítido a qualquer largura.
 */
function qrCode(push: (...xs: number[]) => void, data: string, moduleSize: number) {
  const bytes = Array.from(new TextEncoder().encode(data));
  const len = bytes.length + 3;
  push(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00);              // modelo 2
  push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize);              // tamanho do módulo
  push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);                    // correcção M
  push(0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes); // dados
  push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);                    // imprimir
  push(0x0a);
}

/**
 * Bytes ESC/POS do talão (58mm=32 col, 80mm=48 col) na ORDEM do talão de
 * referência: empresa (nome grande, slogan, morada/NIF/contactos centrados)
 * → faixa tracejada "Designação | Nº" → via + data/hora → Nome do cliente →
 * "Referência Produto" / "Qtd. x Preço | Taxa | Total" → artigos → nota de
 * isenção (*) → Total grande + meios de pagamento → quadro %IVA/Incidência/IVA
 * → "{hash}-Processado por programa validado…" → QR/legendas/rodapé.
 */
function buildBytes(r: RawReceipt, paper: '58' | '80'): Uint8Array {
  const COLS = paper === '58' ? 32 : 48;
  const b: number[] = [];
  const push = (...xs: number[]) => b.push(...xs);
  const raw = (s: string) => push(...encodePt(s));
  const line = (s = '') => { raw(s.length > COLS ? s.slice(0, COLS) : s); push(0x0a); };
  const wrap = (s: string) => { let rest = s; while (rest.length > COLS) { const cut = rest.lastIndexOf(' ', COLS); const at = cut > 8 ? cut : COLS; line(rest.slice(0, at)); rest = rest.slice(at).trimStart(); } line(rest); };
  const center = (on: boolean) => push(0x1b, 0x61, on ? 1 : 0);
  const bold = (on: boolean) => push(0x1b, 0x45, on ? 1 : 0);
  const size = (w2: boolean, h2: boolean) => push(0x1d, 0x21, (w2 ? 0x10 : 0) | (h2 ? 0x01 : 0));
  const dashed = () => line('-'.repeat(COLS));
  const kvLine = (k: string, v: string, cols = COLS) => {
    const space = cols - k.length - v.length;
    line(space > 0 ? k + ' '.repeat(space) + v : `${k} ${v}`);
  };
  // 3 colunas: esquerda | centro (taxa) | direita (total)
  const col3 = (a: string, m: string, z: string) => {
    const wz = Math.max(z.length, paper === '58' ? 10 : 14), wm = paper === '58' ? 5 : 8;
    const wa = COLS - wm - wz;
    const A = a.length > wa ? a.slice(0, wa) : a + ' '.repeat(wa - a.length);
    const pad = Math.max(0, wm - m.length), M = ' '.repeat(Math.floor(pad / 2)) + m + ' '.repeat(Math.ceil(pad / 2));
    const Z = ' '.repeat(Math.max(0, wz - z.length)) + z;
    line(A + M + Z);
  };

  push(0x1b, 0x40);            // init
  push(0x1b, 0x74, 3);         // codepage 3 = CP860 (português)

  // ── Cabeçalho da empresa ──
  center(true);
  if (r.company) { bold(true); size(false, true); wrap(r.company); size(false, false); bold(false); }
  if (r.slogan) { bold(true); wrap(r.slogan); bold(false); }
  const head = r.headerLines?.length ? r.headerLines : (r.meta ? [r.meta] : []);
  for (const h of head) wrap(h);
  center(false);
  line();

  // ── Designação | Nº ──
  dashed();
  kvLine(r.docTitle || 'Documento', r.title);
  dashed();
  kvLine(r.via || 'Original', r.date);
  line();
  if (r.customer) line(`Nome: ${r.customer}`);
  if (r.customerNif) line(`NIF: ${r.customerNif}`);
  if (r.operator) line(`Operador: ${r.operator}`);

  // ── Artigos ──
  if (r.items?.length) {
    line('Referencia Produto');
    col3('Qtd. x Preco', 'Taxa', 'Total');
    dashed();
    for (const it of r.items) {
      wrap(`${it.code ? `${it.code} ` : ''}${it.description}${it.exempt ? '*' : ''}`);
      col3(`${it.quantity} x ${num(it.unitPrice)}`, it.ivaRate != null ? `${it.ivaRate}%` : '', num(it.total + (it.discount ?? 0)));
      if (it.discount && it.discount > 0) kvLine(`  Desconto ${(Math.round((it.discountRate ?? 0) * 1000) / 10).toLocaleString('pt-PT')}%`, `-${num(it.discount)}`);
    }
    dashed();
  }
  for (const e of r.exemptions ?? []) wrap(`* ${e}`);
  line();

  // ── Total e pagamentos ──
  bold(true); size(false, true); kvLine('Total', `Kz ${num(r.grossTotal)}`); size(false, false); bold(false);
  for (const p of r.payments ?? []) kvLine(p.label, `Kz ${num(p.amount)}`);
  if (r.change != null && r.change > 0) kvLine('Troco', `Kz ${num(r.change)}`);
  line();

  // ── Quadro de IVA ──
  const rows = r.taxRows?.length ? r.taxRows : [{ label: '', base: r.netTotal, iva: r.ivaTotal, rate: r.netTotal > 0 ? Math.round((r.ivaTotal / r.netTotal) * 100) : 0 }];
  // %IVA | Incidência | IVA (incidência no meio, alinhada à direita da coluna)
  const ivaRow = (a: string, m: string, z: string) => {
    const wz = paper === '58' ? 9 : 12, wm = paper === '58' ? 12 : 16, wa = COLS - wm - wz;
    line((a + ' '.repeat(wa)).slice(0, wa) + (' '.repeat(wm) + m).slice(-wm) + (' '.repeat(wz) + z).slice(-wz));
  };
  ivaRow('%IVA', 'Incidencia', 'IVA');
  for (const t of rows) ivaRow(String(t.rate ?? (t.label.replace(/[^\d]/g, '') || '0')), num(t.base), num(t.iva));
  dashed();

  // ── Processado por… (hash à frente), QR, legendas e rodapé ──
  center(true);
  if (r.processedBy) wrap(`${r.hash ? `${r.hash}-` : ''}${r.processedBy}`);
  else if (r.hash) line(`Controlo (Hash): ${r.hash}`);
  if (r.qr) qrCode(push, r.qr, paper === '58' ? 4 : 6);
  for (const l of r.legends ?? []) wrap(l);
  for (const l of r.footer ?? []) wrap(l);
  center(false);
  push(0x0a, 0x0a, 0x0a, 0x0a);      // avanço para o corte
  push(0x1d, 0x56, 0x42, 0x00);      // corte parcial (GS V B 0)
  return new Uint8Array(b);
}
/**
 * Imprime DIRETO na térmica emparelhada. Devolve true se saiu; false se não há
 * impressora utilizável (o chamador deve cair no window.print()).
 */
export async function printRaw(r: RawReceipt, paper: '58' | '80'): Promise<boolean> {
  const dev = await getPairedDevice();
  if (!dev) return false;
  const bytes = buildBytes(r, paper);
  try {
    if (!dev.opened) await dev.open();
    if (!dev.configuration) await dev.selectConfiguration(1);
    const out = findOut(dev);
    if (!out) { await dev.close(); return false; }
    await dev.claimInterface(out.ifaceNumber);
    // Blocos de 4KB (buffers grandes encravam algumas térmicas).
    for (let i = 0; i < bytes.length; i += 4096) {
      await dev.transferOut(out.endpoint, bytes.slice(i, i + 4096));
    }
    await dev.releaseInterface(out.ifaceNumber).catch(() => undefined);
    await dev.close().catch(() => undefined);
    return true;
  } catch {
    // Ex.: Windows prendeu o dispositivo ao driver usbprint → sem acesso cru.
    await dev.close().catch(() => undefined);
    return false;
  }
}
