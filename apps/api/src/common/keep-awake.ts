/**
 * Impede o Render (plano grátis) de adormecer a API.
 *
 * O plano grátis suspende o serviço após ~15 min SEM pedidos HTTP de fora. Um
 * pedido que a própria API faz ao seu endereço PÚBLICO (RENDER_EXTERNAL_URL, que
 * o Render define sozinho) entra pelo balanceador do Render e conta como tráfego
 * — por isso, de 9 em 9 min, ela "visita-se" a si própria e nunca chega aos 15.
 *
 * Só liga no Render (variável presente): no posto local (Windows) e em
 * desenvolvimento não há RENDER_EXTERNAL_URL e isto não faz nada.
 *
 * O workflow `keep-alive` do GitHub continua útil como rede de segurança: acorda
 * a API se ela alguma vez for reiniciada/suspensa (o GitHub só garante o horário
 * "de vez em quando", por isso sozinho não bastava).
 */
export const KEEP_AWAKE_INTERVAL_MS = 9 * 60 * 1000;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface KeepAwakeOptions {
  intervalMs?: number;
  fetchFn?: FetchLike;
  log?: (msg: string) => void;
}

/** Devolve a função que pára o ciclo, ou `null` se não há URL pública (não liga). */
export function startKeepAwake(publicUrl: string | undefined, opts: KeepAwakeOptions = {}): (() => void) | null {
  const base = publicUrl?.trim().replace(/\/+$/, '');
  if (!base) return null;
  const fetchFn: FetchLike = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const log = opts.log ?? (() => undefined);
  const ping = async (): Promise<void> => {
    try {
      const r = await fetchFn(`${base}/health`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) log(`keep-awake: /health respondeu ${r.status}`);
    } catch (e) {
      log(`keep-awake: falhou (${e instanceof Error ? e.message : String(e)})`);
    }
  };
  const timer = setInterval(() => { void ping(); }, opts.intervalMs ?? KEEP_AWAKE_INTERVAL_MS);
  return () => clearInterval(timer);
}
