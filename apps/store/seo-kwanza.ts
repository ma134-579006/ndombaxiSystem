import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * SEO do LPS Kwanza (marketplace de associados).
 *
 * A loja é uma SPA: o Cloudflare serve o mesmo index.html a todos os caminhos, e o
 * Google veria "Loja — LPS Vendas" também em /kwanza. Depois do build geramos
 * `kwanza.html` (servido em /kwanza pelo _redirects) com título, descrição, ligação
 * canónica, Open Graph/Twitter, dados estruturados (WebSite + Organization +
 * SoftwareApplication) e um bloco de texto legível sem JavaScript. Também
 * `robots.txt` e `sitemap.xml` com as páginas públicas.
 */
const ORIGIN = 'https://loja.ndombaxisystem.com';
const URL = `${ORIGIN}/kwanza`;
const TITLE = 'LPS Kwanza — Marketplace de associados | Venda e ganhe comissões em Angola';
const DESC = 'LPS Kwanza é o marketplace de associados da LPS Vendas: escolha produtos de várias empresas angolanas, partilhe a sua ligação e ganhe comissões em Kwanzas por cada venda. Registo grátis.';
const KEYWORDS = 'LPS Kwanza, LPS Vendas, marketplace Angola, associados, afiliados, ganhar comissões, vender online Angola, Kwanza, loja online';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function head(): string {
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'LPS Kwanza', alternateName: ['LPS Kwanza Marketplace', 'Kwanza LPS'], url: URL, inLanguage: 'pt-AO',
      potentialAction: { '@type': 'SearchAction', target: `${URL}#/busca?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'LPS Kwanza', url: URL, logo: `${ORIGIN}/kwanza-icon-512.png`, parentOrganization: { '@type': 'Organization', name: 'LPS Vendas', url: 'https://ndombaxisystem.com' } },
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'LPS Kwanza', operatingSystem: 'Android, Windows', applicationCategory: 'ShoppingApplication', url: URL, offers: { '@type': 'Offer', price: '0', priceCurrency: 'AOA' } },
  ];
  return [
    `<title>${esc(TITLE)}</title>`,
    `<meta name="description" content="${esc(DESC)}" />`,
    `<meta name="keywords" content="${esc(KEYWORDS)}" />`,
    '<meta name="robots" content="index, follow, max-image-preview:large" />',
    '<meta name="application-name" content="LPS Kwanza" />',
    '<meta name="apple-mobile-web-app-title" content="LPS Kwanza" />',
    '<meta name="theme-color" content="#1a24c4" />',
    `<link rel="canonical" href="${URL}" />`,
    '<link rel="icon" type="image/svg+xml" href="/kwanza-icon.svg" />',
    '<link rel="icon" type="image/png" sizes="512x512" href="/kwanza-icon-512.png" />',
    '<link rel="apple-touch-icon" href="/kwanza-icon-512.png" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="LPS Kwanza" />',
    '<meta property="og:locale" content="pt_AO" />',
    `<meta property="og:title" content="${esc(TITLE)}" />`,
    `<meta property="og:description" content="${esc(DESC)}" />`,
    `<meta property="og:url" content="${URL}" />`,
    `<meta property="og:image" content="${ORIGIN}/kwanza-icon-512.png" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${esc(TITLE)}" />`,
    `<meta name="twitter:description" content="${esc(DESC)}" />`,
    ...ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`),
  ].join('\n    ');
}

const NOSCRIPT = `<noscript><main style="font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 16px">
      <h1>LPS Kwanza — Marketplace de associados</h1>
      <p>${esc(DESC)}</p>
      <h2>Como funciona</h2>
      <ol><li>Crie a sua conta de associado grátis.</li><li>Escolha produtos das empresas no marketplace.</li><li>Partilhe a sua ligação no WhatsApp e redes sociais.</li><li>Receba a comissão quando a empresa marcar a venda como concluída e peça o saque.</li></ol>
      <p>Aplicações LPS Kwanza para Android e Windows disponíveis em <a href="https://ndombaxisystem.com">ndombaxisystem.com</a>.</p>
    </main></noscript>`;

export function kwanzaSeo(): Plugin {
  let outDir = 'dist';
  let isAppBuild = false;
  return {
    name: 'lps-kwanza-seo',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); isAppBuild = c.base === './'; },
    closeBundle() {
      // Nas apps (base relativa) não há SEO: são abertas localmente.
      if (isAppBuild) return;
      const indexPath = path.join(outDir, 'index.html');
      if (!fs.existsSync(indexPath)) return;
      let html = fs.readFileSync(indexPath, 'utf8');
      html = html.replace(/<title>[\s\S]*?<\/title>/, head())
        .replace(/<meta name="theme-color"[^>]*>\s*/, '')
        .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\s*/g, '')
        .replace('<div id="root"></div>', `<div id="root"></div>\n    ${NOSCRIPT}`);
      fs.writeFileSync(path.join(outDir, 'kwanza.html'), html);
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${URL}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
</urlset>
`);
    },
  };
}
