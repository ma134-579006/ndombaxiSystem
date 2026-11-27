# Apps — voltar à escolha Admin/Caixa (2026-11-27)

Pedido do utilizador: nas apps, quando alguém entra na Caixa pelo painel de Admin e termina a sessão da Caixa, tem de haver um botão que volte ao ecrã que escolhe entre Admin e Caixa.

## Causa (QA-040)
- O botão de voltar ao lançador ( no móvel,  no desktop) esconde-se quando há sessão ativa e volta no login.
- Detetava a sessão pelas chaves dos dois módulos ao mesmo tempo ( e ).
- Na app móvel, a Gestão e a Caixa partilham a origem (, ). Ao abrir a Caixa a partir do Admin, a sessão da Gestão continuava guardada, por isso o botão nunca aparecia na Caixa, nem depois de terminar a sessão.

## Correção
- Cada módulo olha só para a sua própria sessão: Caixa → ; Gestão →  (móvel pelo caminho, desktop pelo host ).
- O botão passa a ter o texto «Início» ao lado da seta.
- No site (navegador) nada muda: o botão só existe nas apps.

## Teste
: app móvel simulada (mesma origem, lançador em ), a Caixa real de QA em  com o  injetado como no , e a sessão do Admin guardada.

| Verificação | main | correção |
|---|---|---|
| L1 login da Caixa (Admin com sessão): botão visível | FAIL | PASS |
| L2 com sessão na Caixa: botão escondido | PASS | PASS |
| L3 depois de «Terminar sessão»: botão visível | FAIL | PASS |
| L4 o botão leva ao lançador | FAIL | PASS |

Desktop: mesma lógica no  (typecheck sem erros novos). Não foi gerado nenhum instalador.
