/**
 * Protocolo `ndombaxi://` para servir os frontends a partir do disco.
 *
 * Porque não `file://`? Por uma razão técnica que decide tudo o resto: o
 * Chromium não considera `file://` um CONTEXTO SEGURO, e sem contexto seguro
 * não há `crypto.subtle`. Sem `crypto.subtle` não há cifra em repouso nem
 * verificação do PIN offline — ou seja, metade da arquitetura deixava de
 * funcionar. Um esquema próprio registado como `secure: true` resolve isso e,
 * de caminho, dá-nos uma origem estável para o `localStorage` e o `IndexedDB`
 * sobreviverem a atualizações da aplicação.
 *
 * Segundo motivo: os frontends são compilados com caminhos absolutos
 * (`/assets/index-abc.js`). Com `file://` esses caminhos apontavam para a raiz
 * do disco. Aqui, a raiz é a pasta do módulo — e cada módulo tem a sua.
 */
import { protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const SCHEME = 'ndombaxi';

/**
 * Tem de ser chamado ANTES de `app.whenReady()` — é o que dá ao esquema os
 * privilégios de um `https://` normal.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,          // ← contexto seguro: habilita crypto.subtle
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }]);
}

/**
 * Política de segurança de conteúdo da aplicação instalada.
 *
 * Na web, a CSP dos três sites vem dos cabeçalhos do Cloudflare (`_headers`).
 * Aqui não há Cloudflare — os ficheiros saem do disco — por isso é este
 * protocolo que a aplica. Assim a app instalada fica com a MESMA proteção do
 * site sem termos de tocar no HTML dos frontends (o que arriscaria partir o
 * deploy web para resolver um problema do desktop).
 *
 * `connect-src` inclui `https:` porque a API do cliente é configurável — mas
 * `default-src 'self'` garante que nenhum script externo é carregado ou
 * executado, que é o que realmente interessa travar.
 */
const CSP = [
  "default-src 'self'",
  // 'self' para os bundles dos frontends e do lançador. O Google Sign-In
  // (accounts.google.com/gsi + apis.google.com) é carregado no ecrã de login
  // "Entrar com Google" — sem isto a CSP bloqueava-o e o login com Google não
  // funcionava na app instalada. gstatic serve recursos auxiliares do GSI.
  "script-src 'self' https://accounts.google.com https://apis.google.com https://www.gstatic.com",
  // Os frontends usam estilos em linha (styled/inline) — herdado da web.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  // O Google Sign-In desenha o seu seletor de conta num iframe próprio.
  "frame-src https://accounts.google.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // 'self' (não 'none'): o GSI pode submeter para o próprio domínio Google.
  "form-action 'self' https://accounts.google.com",
].join('; ');

/**
 * Liga o protocolo às pastas dos módulos.
 * @param roots mapa `nome do módulo` → `pasta com o build do frontend`
 */
export function serveModules(roots: Record<string, string>): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    // ndombaxi://caixa/assets/index.js  →  host = "caixa", pathname = "/assets/index.js"
    const root = roots[url.host];
    if (!root) return new Response('Módulo desconhecido', { status: 404 });

    const relative = decodeURIComponent(url.pathname);
    const target = path.join(root, relative);

    // Barreira anti travessia de caminho: um `../../` numa etiqueta <img> não
    // pode conseguir ler ficheiros fora da pasta do módulo.
    const normalizedRoot = path.resolve(root) + path.sep;
    if (!path.resolve(target).startsWith(normalizedRoot)) {
      return new Response('Acesso negado', { status: 403 });
    }

    // SPA: qualquer rota que não seja um ficheiro real devolve o index.html,
    // para o encaminhamento do React funcionar como funciona na web.
    const file = fs.existsSync(target) && fs.statSync(target).isFile()
      ? target
      : path.join(root, 'index.html');

    const response = await net.fetch(pathToFileURL(file).toString());
    // Reconstruímos a resposta para lhe acrescentar os cabeçalhos de segurança:
    // o `Response` devolvido pelo `net.fetch` tem os cabeçalhos imutáveis.
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, { status: response.status, headers });
  });
}
