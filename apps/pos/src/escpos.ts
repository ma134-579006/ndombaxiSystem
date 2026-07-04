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
  meta?: string | null;      // NIF · morada
  title: string;             // nº do documento (+ "2ª via")
  date: string;
  customer?: string | null;
  operator?: string | null;
  items?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  netTotal: number; ivaTotal: number; grossTotal: number;
  hash?: string | null;
  legends?: string[];
  footer?: string[];
}

const kz = (n: number) => n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kz';

/** Monta os bytes ESC/POS do recibo (largura 58mm=32 col, 80mm=48 col). */
function buildBytes(r: RawReceipt, paper: '58' | '80'): Uint8Array {
  const COLS = paper === '58' ? 32 : 48;
  const b: number[] = [];
  const push = (...xs: number[]) => b.push(...xs);
  const raw = (s: string) => push(...encodePt(s));
  const line = (s = '') => { raw(s.length > COLS ? s.slice(0, COLS) : s); push(0x0a); };
  const center = (on: boolean) => push(0x1b, 0x61, on ? 1 : 0);
  const bold = (on: boolean) => push(0x1b, 0x45, on ? 1 : 0);
  const big = (on: boolean) => push(0x1d, 0x21, on ? 0x11 : 0x00);
  const hr = () => line('-'.repeat(COLS));
  const kvLine = (k: string, v: string) => {
    const space = COLS - k.length - v.length;
    line(space > 0 ? k + ' '.repeat(space) + v : `${k} ${v}`);
  };

  push(0x1b, 0x40);            // init
  push(0x1b, 0x74, 3);         // codepage 3 = CP860 (português)
  center(true);
  if (r.company) { bold(true); line(r.company); bold(false); }
  if (r.meta) line(r.meta);
  line();
  big(true); line(r.title); big(false);
  line(r.date);
  center(false);
  hr();
  if (r.customer) line(`Cliente: ${r.customer}`);
  if (r.operator) line(`Operador: ${r.operator}`);
  if (r.items?.length) {
    hr();
    for (const it of r.items) {
      line(it.description);
      kvLine(`  ${it.quantity} x ${kz(it.unitPrice)}`, kz(it.total));
    }
  }
  hr();
  kvLine('Base tributavel', kz(r.netTotal));
  kvLine('IVA', kz(r.ivaTotal));
  bold(true); kvLine('TOTAL', kz(r.grossTotal)); bold(false);
  if (r.hash) kvLine('Controlo (Hash)', r.hash);
  hr();
  center(true);
  for (const l of r.legends ?? []) line(l);
  for (const l of r.footer ?? []) line(l);
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
