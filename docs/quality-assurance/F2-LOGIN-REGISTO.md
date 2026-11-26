# F2 — Login e registo: Google, Facebook e teclado no telemóvel (2026-11-26)

## Engenharia reversa
- Login/registo (Caixa `apps/pos/src/pages/LoginPage.tsx`, Gestão `apps/web/src/pages/Login.tsx` e `Register.tsx`) usam `useFitHeight` (`vendusAuth.tsx`). A regra «login sem scroll» encolhe o cartão com CSS `zoom` sempre que a janela muda de tamanho.
- O viewport tem `interactive-widget=resizes-content`. No Android, abrir o teclado **reduz a altura da janela** e o `useFitHeight` encolhia o cartão inteiro para caber acima do teclado: letras e campos a ~64%. É a «deformação» (QA-009).
- Google: no browser usa o GIS (token client); na app Android/iOS usa o plugin nativo (`nativeGoogle`); no Windows usa `desktopGoogle`. Facebook: só o SDK JS no browser; nas apps está escondido (QA-012).
- Produção (`GET /public/landing`, só leitura): `facebookAppId: null`. O Facebook Login não está configurado, mas o botão aparecia (QA-011).

## Correção
- `useFitHeight` (Caixa e Gestão): com um campo em edição e só a altura a diminuir (mesma largura, >80 px), não se volta a ajustar. O cartão mantém o tamanho, o contentor `.va` rola e `touchUi.ts` sobe o campo. Ao fechar o teclado ou rodar o ecrã volta a ajustar, e o login continua sem scroll.
- Botão do Facebook só com App ID publicado (Caixa, login e registo da Gestão).

## Testes executados
| Teste | Resultado |
|---|---|
| `qa/login-social.mjs` (API de QA + simulador Google/Facebook) | 17/17 PASS |
| `qa/login-teclado.mjs` contra a main (5182/5184) | **4/10** — F1 e K1 FAIL em Android e iPhone emulados |
| `qa/login-teclado.mjs` contra a correção (5181/5183) | **10/10 PASS** |
| `tsc --noEmit` Caixa e Gestão | OK |

## Não verificado
- Teclado real em iPhone/Android: a emulação reduz a altura da janela (comportamento do Android com `resizes-content`). O Safari do iOS não reduz a janela (só o `visualViewport`), por isso aí o efeito original devia ser menor. Confirmar em dispositivo.
- Login real com contas Google/Facebook: precisa de conta do utilizador; testado só com o simulador.
- Registo da Gestão com teclado: usa o mesmo `useFitHeight`, mas não tem teste dedicado.
