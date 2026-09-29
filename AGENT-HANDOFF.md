# AGENT-HANDOFF — Redesign Enterprise (estado a 2026-09-29)

Só factos auditados/decididos. Atualizar a cada fase.

## Decisões do utilizador
- Ordem obrigatória: Design System → `@nexus/ui` → página de demonstração → Landing (preservando a navbar já redesenhada) → Auth → Admin Shell → Dashboard → Admin → Caixa/POS → Loja online → forms/tabelas/modais globais → responsividade → acessibilidade → QA visual final.
- Identidade: índigo `#2430E8` (tom 600) evoluído; laranja da loja (`--nx-shop-*`) integrado como cor de canal; uma só identidade para o ecossistema.
- Não alterar regras de negócio, APIs, base de dados, permissões ou contratos. Se uma mudança visual exigir isso: PARAR e apresentar o impacto.
- Incrementos pequenos: alterar → typecheck/lint/testes → browser → corrigir → commit.
- **Ecrãs de login e registo NUNCA têm scroll**: o tamanho adapta-se sempre ao ecrã (aplicar na fase Auth).

## Feito
- `packages/tokens/tokens.css`: camada semântica (`--nx-bg/surface/text/primary/channel/...`) com tema claro (padrão) e escuro (`[data-nx-mode="dark"]`), escala tipográfica até 4xl, pesos, breakpoints documentais (480/768/1100/1440), alvos de toque, z-index, estados interativos e foco.
- `packages/ui` (`@nexus/ui`): Button, Field, Input, Select, Textarea, Checkbox, Radio, Switch, Card, Badge, Avatar, Tabs, Alert, Toast, Skeleton, EmptyState, ErrorState, Modal, Drawer, Tooltip, Dropdown, Breadcrumb, PageHeader, NavList, DataTable. Estilos em `src/ui.css` (só tokens `--nx-*`).
- `apps/web/ds.html` + `src/ds-main.tsx`: página de documentação viva (`/ds.html`): tokens, componentes, estados, claro/escuro, comparação lado a lado, larguras 1024/768/390/320. `design.html` (guia do CSS legado do painel) mantém-se.
- Integração no web por alias Vite + `paths` do tsconfig (sem novo `pnpm install`).

## Verificado no browser (built-in, 1280 e 390 px)
Sem overflow horizontal, tema escuro correto, Modal (foco preso, Escape, regresso do foco, scroll bloqueado).

## Por fazer / notas
- Migrar progressivamente os `--primary/--bg` do `theme.css` para `--nx-*` (10 temas legados existem; não remover sem decisão).
- Auditoria: 1.705 `style={{` inline no web, 27 tamanhos de fonte, 12 breakpoints, `components/ui.tsx` só tem Switch/StatusBadge/Modal.
- Pendentes fora do redesign: instalador Windows por testar (silent install não confirmou), APK Android (sem JDK/SDK/keystore), revogar token GitHub vazado, faturas Render/Aiven.

## Atualização (fase 4/5)
- theme.css: bloco "DESIGN SYSTEM v2" remapeia --bg/--surface/--primary do tema `claro` (padrão) e do tema base para `--nx-*`; .btn/.card/.field/.modal/.ptable refinados.
- Auth: login e registo verificados sem scroll a 320×480, 360×400, 390×640, 1440×900 (compactação por max-height 560/420).
- Landing: cores por defeito agora `--nx-brand-600/400`; navbar preservada; foco visível e reduced-motion.
- Limite: ecrãs autenticados (Shell/Dashboard/Admin/POS/Loja) não são testáveis em dev sem sessão real (API bloqueada por CORS no dev; não se introduzem credenciais). Herdam o remap; validação visual pendente em produção.
- Build de produção do web: OK (vite build exit 0).
