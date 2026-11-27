# Atualização obrigatória em todas as apps (2026-11-27)

Pedido do utilizador: «uma correção para todos os apps: depois de publicados devem pedir atualização — o do Android não está a pedir».

## Estado do servidor (verificado, só leitura)
`GET /downloads/latest?platform=…` em produção devolve a versão 3.5.7, `mandatory: true`, para `windows`, `android`, `android-loja`, `android-kwanza` e `windows-kwanza`. A publicação está certa: o problema era das apps.

## Causas encontradas
| # | App | Causa | Efeito |
|---|---|---|---|
| 1 | LPS Vendas Android e Windows | O **lançador** (1.º ecrã, escolher Gestão ou Caixa) não verificava a versão. Só a Gestão e a Caixa o faziam. | Quem abria a app e ficava no lançador nunca via o pedido. |
| 2 | LPS Vendas Android | A CSP do lançador (`default-src 'self'`) não deixava falar com a API. | Mesmo que verificasse, o pedido era bloqueado. |
| 3 | LPS Vendas Windows | A Gestão e a Caixa perguntavam a versão a `API_URL`, que é o **servidor local** (`127.0.0.1`) quando este está a correr. O servidor local não tem `/downloads` e respondia 404. | Postos com servidor local nunca viam o pedido. |
| 4 | LPS Loja e LPS Kwanza | `AbortSignal.timeout` (só existe no Chrome 103+). Numa WebView Android mais antiga lançava erro, que era engolido. | A app nunca pedia a atualização nesses telemóveis. |

## Correção
- `apps/mobile-shell/launcher/update-check.js` (ES5): um só ficheiro para os dois lançadores.
  - No Windows pergunta ao processo principal (`ndombaxi.update.check`); o botão abre a página oficial e fecha a app.
  - No Android pergunta à API oficial com a versão gravada no empacotamento; o botão abre a página oficial e fecha a app.
- O `prepare-web` (Android) grava `native-flag.js` também na raiz do lançador (versão, API, plataforma). O `prepare-resources` (Windows) copia o `update-check.js` para o lançador.
- CSP do lançador Android: `connect-src 'self' https:`.
- Gestão e Caixa: a verificação usa `CLOUD_API_URL` (a nuvem), nunca o servidor local.
- Loja e Kwanza: `AbortController` em vez de `AbortSignal.timeout`.
- Regras mantidas: sem resposta do servidor não se tranca; só uma versão maior do canal de produção e da mesma plataforma tranca; o botão só abre páginas https.

## Testes
`qa/atualizacao-lancador.mjs` (Chromium real, lançadores verdadeiros): **12/12 PASS**.
- Android 3.5.0 com 3.5.7 publicada → ecrã de atualização. Cabe em 360×640. «Atualizar Agora» abre a página oficial. Sem erros de JavaScript.
- Android já na 3.5.7 → lançador normal.
- Servidor sem resposta → não tranca.
- Canal beta ou outra plataforma → ignorado.
- Windows (processo principal simulado): tranca, o botão chama `openDownloadPage`; já atualizado → normal.

UNVERIFIED: num telemóvel real. Só se confirma com o próximo APK publicado: instalar uma versão anterior e publicar uma nova.
