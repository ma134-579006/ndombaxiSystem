/**
 * Detector de códigos de barras UNIVERSAL:
 *   • Chrome/Android → BarcodeDetector nativo (rápido, GPU);
 *   • iPhone/Safari (sem BarcodeDetector) → fallback ZXing carregado por
 *     import dinâmico SÓ quando é preciso (não pesa o bundle inicial).
 *
 * Devolve uma função `detect(video)` → código lido ou null nesse frame.
 */

export type FrameDetector = (video: HTMLVideoElement) => Promise<string | null>;

/** Formatos lineares de retalho (sem QR — reduz leituras erradas). */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

interface NativeDetector { detect(src: unknown): Promise<{ rawValue: string }[]> }

export async function makeDetector(): Promise<FrameDetector> {
  const BD = (window as unknown as { BarcodeDetector?: new (o?: unknown) => NativeDetector }).BarcodeDetector;
  if (BD) {
    const d = new BD({ formats: FORMATS } as unknown);
    return async (video) => {
      try {
        const codes = await d.detect(video);
        return codes?.length ? String(codes[0].rawValue).trim() || null : null;
      } catch { return null; }
    };
  }

  // ── iPhone/Safari: ZXing (decodifica frames desenhados num canvas) ──
  const [{ BrowserMultiFormatReader }, zx] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
    zx.BarcodeFormat.EAN_13, zx.BarcodeFormat.EAN_8, zx.BarcodeFormat.UPC_A,
    zx.BarcodeFormat.UPC_E, zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39, zx.BarcodeFormat.ITF,
  ]);
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastTry = 0;
  return async (video) => {
    // o ZXing é mais pesado por frame → limita a ~6 leituras/segundo
    const now = Date.now();
    if (now - lastTry < 160 || !video.videoWidth || !ctx) return null;
    lastTry = now;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    try {
      const r = reader.decodeFromCanvas(canvas);
      return String(r.getText()).trim() || null;
    } catch { return null; /* frame sem código */ }
  };
}

/**
 * Descodifica TODOS os QR de uma IMAGEM (ex.: foto do «Guia» do DVR, que tem 3).
 *   • Chrome/Android → BarcodeDetector deteta vários QR de uma vez.
 *   • iPhone/Safari  → ZXing (um QR; o utilizador pode recortar/aproximar).
 * Devolve a lista de conteúdos lidos (sem repetidos).
 */
export async function decodeQrFromImage(file: File): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const out = new Set<string>();
  const BD = (window as unknown as { BarcodeDetector?: new (o?: unknown) => NativeDetector }).BarcodeDetector;
  if (BD) {
    try {
      const d = new BD({ formats: ['qr_code'] } as unknown);
      const codes = await d.detect(bitmap as unknown);
      for (const c of codes ?? []) { const v = String(c.rawValue).trim(); if (v) out.add(v); }
    } catch { /* cai para ZXing */ }
  }
  if (out.size === 0) {
    // ZXing sobre canvas (um QR de cada vez)
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0);
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        const reader = new BrowserQRCodeReader();
        const r = reader.decodeFromCanvas(canvas);
        const v = String(r.getText()).trim(); if (v) out.add(v);
      } catch { /* sem QR legível */ }
    }
  }
  bitmap.close?.();
  return [...out];
}

/** Ecrã tátil (telemóvel/tablet)? Nos COMPUTADORES a câmara não deve abrir —
 *  usa-se o leitor físico USB ou a pesquisa. */
export function isTouchDevice(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1; }
  catch { return false; }
}

/** Detector de QR CODE (para configurar câmaras por QR). */
export async function makeQrDetector(): Promise<FrameDetector> {
  const BD = (window as unknown as { BarcodeDetector?: new (o?: unknown) => NativeDetector }).BarcodeDetector;
  if (BD) {
    const d = new BD({ formats: ['qr_code'] } as unknown);
    return async (video) => {
      try { const c = await d.detect(video); return c?.length ? String(c[0].rawValue).trim() || null : null; }
      catch { return null; }
    };
  }
  const [{ BrowserQRCodeReader }] = await Promise.all([import('@zxing/browser')]);
  const reader = new BrowserQRCodeReader();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastTry = 0;
  return async (video) => {
    const now = Date.now();
    if (now - lastTry < 200 || !video.videoWidth || !ctx) return null;
    lastTry = now;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    try { return String(reader.decodeFromCanvas(canvas).getText()).trim() || null; }
    catch { return null; }
  };
}
