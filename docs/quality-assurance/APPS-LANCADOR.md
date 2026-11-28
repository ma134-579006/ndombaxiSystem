# Apps — voltar à escolha Admin/Caixa (2026-11-27)

Pedido do utilizador: nas apps, quando alguém entra na Caixa pelo painel de Admin e termina a sessão da Caixa, tem de haver um botão que volte ao ecrã que escolhe entre Admin e Caixa.

## Causa (QA-040)
- O botão de voltar ao lançador (`back-launcher.js` no móvel, `preload` no desktop) esconde-se quando há sessão ativa e volta no login.
- Detetava a sessão pelas chaves dos dois módulos ao mesmo tempo (`ndombaxi.web.access` e `nexus.pos.access`).
- Na app móvel, a Gestão e a Caixa partilham a origem (`www/gestao`, `www/caixa`). Ao abrir a Caixa a partir do Admin, a sessão da Gestão continuava guardada, por isso o botão nunca aparecia na Caixa, nem depois de terminar a sessão.

## Correção
- Cada módulo olha só para a sua própria sessão: Caixa → `nexus.pos.access`; Gestão → `ndombaxi.web.access` (móvel pelo caminho, desktop pelo host `ndombaxi://caixa` / `ndombaxi://gestao`).
- O botão passa a ter o texto «Início» ao lado da seta.
- No site (navegador) nada muda: o botão só existe nas apps.

## Teste
`qa/lancador-voltar.mjs`: app móvel simulada (mesma origem, lançador em `www/index.html`), a Caixa real de QA em `/caixa/` com o `back-launcher.js` injetado como no `prepare-web.mjs`, e a sessão do Admin guardada.

| Verificação | main | correção |
|---|---|---|
| L1 login da Caixa (Admin com sessão): botão visível | FAIL | PASS |
| L2 com sessão na Caixa: botão escondido | PASS | PASS |
| L3 depois de «Terminar sessão»: botão visível | FAIL | PASS |
| L4 o botão leva ao lançador | FAIL | PASS |

Desktop: mesma lógica no `preload` (typecheck sem erros novos). Não foi gerado nenhum instalador.
