/**
 * Plugin PostCSS (usado pelo Vite da Caixa, Gestão e Loja): protege o fallback em `vh`
 * nos navegadores sem unidades dinâmicas (Chrome < 108, Safari < 15.4).
 *
 * Problema: `height: calc(100vh / var(--uz, 1)); height: calc(100dvh / var(--uz, 1));`
 * — como a 2.ª declaração tem `var()`, o motor antigo NÃO a descarta ao ler o CSS; aceita-a
 * e só a anula ao calcular (fica `unset`), apagando o fallback em `vh` (missão QA, QA-023).
 *
 * Solução: cada declaração com dvh/svh/lvh **e** `var()` passa para
 * `@supports (height: 1dvh) { <mesmo seletor> { … } }` logo a seguir à regra original
 * (mesma especificidade, mesma ordem na cascata). Os ficheiros CSS ficam intactos.
 */
const UNIDADE_DINAMICA = /\d(?:dvh|svh|lvh|dvw|svw|lvw|dvi|dvb|dvmin|dvmax)\b/i;

interface No { type: string; parent?: No; nodes?: No[]; remove(): void; clone(o?: object): No; after(n: No): void; append(n: No): void }
interface Decl extends No { prop: string; value: string; important?: boolean }
interface Regra extends No { selector: string; walkDecls(cb: (d: Decl) => void): void }
interface Raiz { walkRules(cb: (r: Regra) => void): void }
interface Helpers { AtRule: new (o: { name: string; params: string }) => No }

export function dvhFallback() {
  return {
    postcssPlugin: 'ndombaxi-dvh-fallback',
    Once(root: Raiz, { AtRule }: Helpers) {
      const regras: Regra[] = [];
      root.walkRules((r) => { regras.push(r); });
      for (const regra of regras) {
        // Não mexer dentro de @keyframes (os passos não são seletores).
        let p = regra.parent as (No & { name?: string }) | undefined;
        let emKeyframes = false;
        while (p) { if (p.type === 'atrule' && /keyframes$/i.test(p.name ?? '')) emKeyframes = true; p = p.parent as typeof p; }
        if (emKeyframes) continue;
        const mover: Decl[] = [];
        regra.walkDecls((d) => { if (d.parent === regra && d.value.includes('var(') && UNIDADE_DINAMICA.test(d.value)) mover.push(d); });
        if (!mover.length) continue;
        const copia = regra.clone({ nodes: [] });
        for (const d of mover) { d.remove(); copia.append(d); }
        const sup = new AtRule({ name: 'supports', params: '(height: 1dvh)' });
        sup.append(copia);
        regra.after(sup);
        if (!regra.nodes?.length) regra.remove();
      }
    },
  };
}
dvhFallback.postcss = true;
