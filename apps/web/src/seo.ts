// SEO do site público. O endereço oficial é https://lpsvendas.com.de — o domínio
// antigo redireciona 301 para aqui. Só a landing (/) e a página de download
// (/baixar) devem aparecer no Google; os subdomínios de aplicação (admin, caixa,
// www) e as páginas internas ficam com noindex para não competirem nos resultados.
export const SITE_ORIGIN = 'https://lpsvendas.com.de';
const PUBLIC_PATHS = /^\/(baixar\/?)?$/i;

export function initSeo(): void {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  if (!/^https?:$/.test(location.protocol)) return; // app instalada (file:// / app://)
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const canonical = `${SITE_ORIGIN}${path === '/' ? '/' : path}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = canonical;
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical);

  const mainHost = location.hostname === 'lpsvendas.com.de';
  if (!mainHost || !PUBLIC_PATHS.test(location.pathname)) {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, follow';
    document.head.appendChild(meta);
  }
}
