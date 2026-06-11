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

/** Ecrã tátil (telemóvel/tablet)? Nos COMPUTADORES a câmara não deve abrir —
 *  usa-se o leitor físico USB ou a pesquisa. */
export function isTouchDevice(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1; }
  catch { return false; }
}
