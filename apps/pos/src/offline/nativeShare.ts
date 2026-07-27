/**
 * Ponte para os ficheiros NATIVOS na app instalada (Capacitor). A WebView do
 * Android não sabe descarregar nem partilhar ficheiros (blob/`<a download>` não
 * funcionam) — por isso a fatura ia só como texto e o PDF não descarregava.
 *
 * Quando corre na app, usamos os plugins Filesystem + Share pelo bridge global
 * (`window.Capacitor.Plugins`), sem precisar de os empacotar no bundle. No site
 * (navegador) estas funções devolvem null/false e o código web habitual trata do
 * download/partilha. Tudo defensivo: qualquer falha cai para o caminho web.
 */
interface CapFilesystem {
  writeFile(o: { path: string; data: string; directory?: string; recursive?: boolean }): Promise<{ uri: string }>;
  getUri(o: { path: string; directory?: string }): Promise<{ uri: string }>;
}
interface CapShare {
  share(o: { title?: string; text?: string; url?: string; files?: string[] }): Promise<void>;
}
interface CapBridge {
  isNativePlatform?: () => boolean;
  Plugins?: { Filesystem?: CapFilesystem; Share?: CapShare };
}

function bridge(): CapBridge | null {
  const w = window as unknown as { Capacitor?: CapBridge };
  const cap = w.Capacitor;
  if (cap && (cap.isNativePlatform ? cap.isNativePlatform() : false)) return cap;
  return null;
}

/** True quando corre dentro da app instalada (Android/iOS). */
export function isNativeApp(): boolean {
  return !!bridge();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Guarda o PDF no aparelho (pasta Documentos) e devolve o URI — o "descarregar"
 * da app. Devolve null se não for nativo ou se falhar (o chamador cai para o web).
 */
export async function saveNativePdf(blob: Blob, filename: string): Promise<string | null> {
  const fs = bridge()?.Plugins?.Filesystem;
  if (!fs) return null;
  try {
    const data = await blobToBase64(blob);
    const res = await fs.writeFile({ path: filename, data, directory: 'DOCUMENTS', recursive: true });
    return res.uri;
  } catch {
    return null;
  }
}

/**
 * Escreve o PDF na cache e abre a partilha NATIVA com o FICHEIRO (WhatsApp e
 * outras apps recebem a fatura A4 real, não só texto). Devolve false se não for
 * possível (o chamador cai para o resumo/texto).
 */
export async function shareNativePdf(blob: Blob, filename: string, title: string, text: string): Promise<boolean> {
  const p = bridge()?.Plugins;
  if (!p?.Filesystem || !p?.Share) return false;
  try {
    const data = await blobToBase64(blob);
    await p.Filesystem.writeFile({ path: filename, data, directory: 'CACHE', recursive: true });
    const { uri } = await p.Filesystem.getUri({ path: filename, directory: 'CACHE' });
    await p.Share.share({ title, text, files: [uri] });
    return true;
  } catch {
    return false;
  }
}
