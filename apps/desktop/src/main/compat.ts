/**
 * Compatibilidade com a EDIÇÃO LEGADO (Windows 7, 8 e 8.1).
 *
 * O Electron 23+ só corre no Windows 10/11. Para o Windows 7/8/8.1 há um segundo
 * instalador (electron-builder-legacy.yml) com o Electron 22 — o último que lá corre.
 * O mesmo código serve as duas edições; aqui ficam as diferenças:
 *   • `protocol.handle` / `net.fetch` só existem no Electron ≥ 25 → reserva com
 *     `registerBufferProtocol` (ver protocol.ts);
 *   • o `fetch` global só existe no Node ≥ 18 (o Electron 22 traz o Node 16) → `mainFetch`;
 *   • a edição legado procura atualizações na plataforma própria `windows7`, para o
 *     botão de atualização levar ao instalador certo (o moderno nem abre no Windows 7);
 *   • sem servidor local (o PostgreSQL 16 não corre no Windows 7): trabalha contra a
 *     nuvem, com a fila offline dos frontends.
 */
import { net } from 'electron';

const major = Number(String(process.versions.electron ?? '0').split('.')[0]) || 0;

/**
 * Edição legado (Electron < 23 → Windows 7/8/8.1). `NDOMBAXI_LEGACY=1` força o caminho legado
 * num Electron atual — só para testar as reservas sem instalar o Electron 22.
 */
export const LEGACY = (major > 0 && major < 23) || process.env.NDOMBAXI_LEGACY === '1';

/** Plataforma desta instalação nas atualizações e em Admin → Aplicações (legado: 64 ou 32 bits). */
export const PLATFORM: 'windows' | 'windows7' | 'windows7-32' = LEGACY ? (process.arch === 'ia32' ? 'windows7-32' : 'windows7') : 'windows';

export interface MiniResponse { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }

/** `fetch` mínimo (GET/POST com cabeçalhos e AbortSignal) que funciona no Node 16. */
export function mainFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}): Promise<MiniResponse> {
  const g = (globalThis as { fetch?: (u: string, i?: unknown) => Promise<MiniResponse> }).fetch;
  if (typeof g === 'function') return g(url, init);
  return new Promise<MiniResponse>((resolve, reject) => {
    const req = net.request({ url, method: init.method ?? 'GET' });
    for (const [k, v] of Object.entries(init.headers ?? {})) req.setHeader(k, v);
    const abort = () => { try { req.abort(); } catch { /* já terminou */ } reject(new Error('abortado')); };
    if (init.signal) { if (init.signal.aborted) return abort(); init.signal.addEventListener('abort', abort, { once: true }); }
    req.on('response', (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(Buffer.from(c)));
      res.on('end', () => {
        const body = Buffer.concat(parts).toString('utf8');
        const status = res.statusCode;
        resolve({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) as unknown });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
