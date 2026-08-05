/**
 * Entrar com Google na aplicação Windows.
 *
 * **Porque é que não se usa o mesmo botão do site.** O Google recusa o seu
 * ecrã de início de sessão dentro de WebViews (política `disallowed_useragent`)
 * — e a janela do Electron é exatamente isso. Foi por essa razão que o botão
 * esteve escondido no desktop: mostrá-lo era prometer algo que acabaria sempre
 * em erro.
 *
 * **O que se faz então**, e é o que o Visual Studio Code, o Slack e a maioria
 * das aplicações de secretária fazem: o início de sessão acontece no **navegador
 * do sistema**, onde a conta Google do utilizador já está aberta, e o resultado
 * volta à aplicação por um servidor que só existe durante esses segundos, só
 * escuta em `127.0.0.1` e desaparece a seguir.
 *
 * **Nada de segredos dentro da aplicação.** Pede-se diretamente o `id_token`
 * (`response_type=id_token`), o mesmo que o botão do site produz — não há troca
 * de código, logo não é preciso um `client_secret` embutido no instalador, que
 * qualquer pessoa conseguiria extrair. O `id_token` segue depois o caminho de
 * sempre (`loginGoogle`), e a API valida-o contra o mesmo cliente Web.
 *
 * ⚠️ **Um passo é do lado do Google Cloud, não do código**: o URI
 * `http://localhost:47821/google/callback` tem de estar nos *URIs de redirecionamento
 * autorizados* do cliente OAuth Web. Sem isso o Google responde
 * `redirect_uri_mismatch` — e é por isso que a mensagem de erro abaixo diz
 * exatamente o que falta lá pôr, em vez de um "falhou" que ninguém sabe resolver.
 */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { shell } from 'electron';

/** O mesmo cliente Web do site — para a API validar o token como sempre. */
const CLIENT_ID = process.env.NDOMBAXI_GOOGLE_CLIENT_ID
  || '522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com';

/**
 * Porta FIXA. Tem de ser fixa porque o URI de redirecionamento é registado à mão
 * no Google Cloud; com porta variável seria preciso registar todas.
 */
const PORT = 47821;
const REDIRECT_URI = `http://localhost:${PORT}/google/callback`;

/** O utilizador pode demorar a escolher a conta — mas não para sempre. */
const TIMEOUT_MS = 3 * 60_000;

export class GoogleAuthError extends Error {}

/** Página mostrada no navegador quando corre bem. */
const PAGINA_OK = `<!doctype html><html lang="pt"><head><meta charset="utf-8">
<title>Ndombaxi System</title></head>
<body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0f1626;color:#eef2ff;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
<div><h1 style="font-size:22px;margin:0 0 10px">Sessão iniciada</h1>
<p style="opacity:.75;margin:0">Já pode voltar ao Ndombaxi System. Esta janela pode ser fechada.</p></div>
</body></html>`;

function fecha(server: Server): void {
  try { server.close(); } catch { /* já fechado */ }
}

/**
 * Abre o Google no navegador do sistema e devolve o `id_token`.
 *
 * Devolve `null` se o utilizador desistir (fechar o navegador sem escolher
 * conta) — desistir não é um erro e não deve encher o ecrã de vermelho.
 */
export function signInWithGoogle(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // `state` e `nonce` novos a cada tentativa: sem eles, uma página qualquer
    // aberta no mesmo computador podia enviar um pedido a este servidor e
    // empurrar um token de outra pessoa para dentro da aplicação.
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    let terminado = false;

    const acabar = (fn: () => void) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      fecha(server);
      fn();
    };

    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (!url.startsWith('/google/callback')) { res.writeHead(404).end(); return; }

      // O Google devolve o token no CORPO (`response_mode=form_post`), não no
      // endereço: assim o token não fica escrito no histórico do navegador nem
      // nos registos de nenhum servidor pelo caminho.
      let corpo = '';
      req.on('data', (c) => {
        corpo += c;
        // Um pedido gigante contra este servidor não pode encher a memória.
        if (corpo.length > 64_000) req.destroy();
      });
      req.on('end', () => {
        const p = new URLSearchParams(corpo);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA_OK);
        const erro = p.get('error');
        if (erro) { acabar(() => reject(new GoogleAuthError(mensagemDeErro(erro)))); return; }
        if (p.get('state') !== state) {
          acabar(() => reject(new GoogleAuthError('Resposta do Google não corresponde a este pedido.')));
          return;
        }
        const idToken = p.get('id_token');
        acabar(() => resolve(idToken || null));
      });
    });

    const temporizador = setTimeout(() => {
      acabar(() => resolve(null)); // desistiu — não é erro
    }, TIMEOUT_MS);

    server.on('error', (e: NodeJS.ErrnoException) => {
      acabar(() => reject(new GoogleAuthError(
        e.code === 'EADDRINUSE'
          ? `A porta ${PORT} está ocupada por outro programa. Feche-o e tente novamente.`
          : 'Não foi possível preparar a entrada com Google neste computador.',
      )));
    });

    // Só `127.0.0.1`: este servidor não fica exposto à rede da loja.
    server.listen(PORT, '127.0.0.1', () => {
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.searchParams.set('client_id', CLIENT_ID);
      auth.searchParams.set('redirect_uri', REDIRECT_URI);
      auth.searchParams.set('response_type', 'id_token');
      auth.searchParams.set('response_mode', 'form_post');
      auth.searchParams.set('scope', 'openid email profile');
      auth.searchParams.set('state', state);
      auth.searchParams.set('nonce', nonce);
      // Mostra sempre o seletor de contas: num computador de loja partilhado,
      // entrar em silêncio com a conta do colega anterior seria um problema.
      auth.searchParams.set('prompt', 'select_account');
      void shell.openExternal(auth.toString()).catch(() => {
        acabar(() => reject(new GoogleAuthError('Não foi possível abrir o navegador.')));
      });
    });
  });
}

function mensagemDeErro(codigo: string): string {
  if (codigo === 'access_denied') return 'Entrada com Google cancelada.';
  if (codigo === 'redirect_uri_mismatch') {
    return `Falta autorizar este computador no Google. Adicione ${REDIRECT_URI} aos URIs de redirecionamento do cliente OAuth.`;
  }
  return `O Google recusou o pedido (${codigo}).`;
}
