# CLAUDE.md
Ver `PROJECT-CONTEXT.md`, `STACK.md` e `AGENT-HANDOFF.md`.
- Incrementos pequenos: alterar → typecheck/build → browser → commit.
- Estilos novos usam tokens `--nx-*`; não remover temas legados sem decisão.
- Novo pacote workspace ⇒ atualizar `pnpm-lock.yaml`.
- Nunca inserir credenciais reais em formulários.
- REGRA PERMANENTE (atualizações): cada app publicada (Windows, Android LPS Vendas, Android LPS Loja) bloqueia automaticamente as versões anteriores. A versão de cada build é `maior.menor.<nº de commits>` (`scripts/ci-version.mjs`); o servidor lê as releases do GitHub (`ReleaseSyncService`, a cada 10 min e em `POST /downloads/sync`) e publica-as como obrigatórias. Não remover nem tornar manual.
