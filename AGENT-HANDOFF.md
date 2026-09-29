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

## Atualização (fases 5–10, produção)
- Cloudflare Pages exige lockfile congelado: todo novo pacote workspace tem de constar em `pnpm-lock.yaml` (importers). `packages/ui` adicionado (sem peerDependencies).
- Verificado em Chrome (produção): /ds, login (sem scroll), dashboard (super-admin e empresa via shadow), Produtos, Novo produto, Reativar, Funcionários.
- Shell: item ativo da sidebar legível; tema claro com elevações/vidro/bordas alinhados aos tokens.
- ErrorBoundary recarrega 1× quando um chunk antigo desaparece após novo deploy.
- POS: `--primary*` vem de `--nx-brand-*`; Loja: `--accent` vem de `--nx-shop-600`.
- PlanExpired: painel pode rolar (conteúdo de pagamento variável); login/registo continuam sem scroll.
- Conta de teste: empresa "Supermercado Teste Ndombaxi" (slug `supermercado-teste-ndombaxi`) reativada +30 dias, com produto "Arroz 1kg".
- Por fazer: validação visual POS/Loja em produção, polimento de tabelas/forms, responsividade 320–1920, acessibilidade, QA final; instalador Windows e APK continuam pendentes.

## Verificação em produção (2026-09-29, Chrome)
- Caixa: login de funcionário (Operador Teste, F-001, email operador.teste@ndombaxi.ao, PIN definido pelo utilizador) → abrir turno → venda em numerário 1.368 Kz → recibo com QR. Stock 50→49. Modais rolam em alturas baixas (`.modal-bg > .card` com overflow).
- Loja: aparência laranja/tokens OK em 1280 e ~657 px, sem overflow horizontal.
- Admin: auditoria a11y básica sem botões sem nome, inputs sem label ou imagens sem alt; `lang="pt"`.
- Por fazer: compra de teste na Loja (exige conta de cliente), polimento adicional de tabelas/forms do admin, QA de 320–1920 nas apps autenticadas, instalador Windows, APK.

## Android / instalador (2026-09-29)
- `.github/workflows/android-build.yml` (manual, "Run workflow"): compila APK DEBUG no Ubuntu (JDK 17, SDK do runner). Run 36562401647 OK; APK em Desktop\Ndombaxi-Instaladores\android\app-debug.apk. Play Store exige keystore própria (não existe). iOS continua a exigir Mac/Apple Developer (workflow ios-build.yml).
- Responsividade verificada em produção: Loja e landing a 320 e 1920 sem overflow; login da Caixa a 320×640 sem scroll.
- Instalador Windows: instalação silenciosa (`/S /D=...`) fica sem janela nem ficheiros extraídos após 25 s — provável pedido de elevação (UAC) que só o utilizador pode aprovar. Teste manual com duplo clique pendente. Pasta vazia C:\ndombaxi-inst-test pode ser apagada à mão.

## Atualização (bloqueio, landing v3, Loja v3)
- Bloqueio de ecrã (web IdleLock + POS IdleLock): cartão em vidro, gradiente índigo, foco/aria, compactação por altura (commit 48d12a1).
- Landing v3: `--lp-primary/accent` = `--nx-brand-*`, Sora/DM Sans com pesos ≤700, ícones em quadrado tonal, sem ciano/roxo/animações de brilho; chat flutuante em índigo sólido.
- Loja v3: estrutura em neutros/índigo (hero índigo), cor da marca (`--accent`, laranja) só em acções/preços; verificado em produção.
- Teste "Nova loja" (empresa de teste): validação do limite do plano (1 loja) funciona com mensagem clara; criar loja com sucesso exigiria plano superior (não alterado).

## Atualização (sem laranja, processamento, shell v4)
- Decisão do utilizador: NÃO pode existir laranja. Loja passou a índigo; avisos em #ca8a04/#a16207.
- Processamento v3: .loading = anel índigo + barra indeterminada + texto a respirar (só com prefers-reduced-motion: no-preference).
- Shell v4 (theme.css "ENTERPRISE v4"): barra lateral clara (tema claro), ícones stroke 1.75, item ativo índigo-50 com indicador, KPIs brancos com ícone tonal índigo (só danger vermelho), hover/entrada animados.

## Atualização (v5, limites de plano)
- Limite de lojas/utilizadores/produtos usa company.plan (fonte de verdade); testado em produção no TEKAMBISSA (Business, 3 lojas): 2.ª e 3.ª criadas, 4.ª bloqueada. Lojas de teste TESTE2/TESTE3 ficaram nessa empresa.
- v5: botões .sm tonais (warn=vermelho suave, sem laranja), list-row responsivo, popover de notificações compacto, .pgrid com formulários >=320px, sidebar sem encolher itens com grupo aberto.
- Varredura mobile (super admin 12 secções + empresa ~16): sem overflow horizontal.

## Atualização final (QA)
- @supports invalido (Loja/Caixa) corrigido: fallbacks laranja/opaco aplicavam-se sempre. Laranja removido de CSS, PDFs e launcher movel.
- Temas escuros verificados no painel real (violeta, neon, esmeralda, oceano, apple); neon com KPIs tonais.
- a11y: aria-label em login da Caixa (email/PIN) e pesquisa por imagem da Loja; auditoria publica sem botoes sem nome nem img sem alt.
- Bloqueio por inatividade (IdleLock) ativa-se tambem em modo shadow; interrompe scripts de teste.

## Atualização (NIF, e-mail, AGT Modelo 8)
- NIF: Company.nif deixou de ser unico (indice normal); aceita 9-10 digitos ou 14 caracteres BI (9 digitos + 2 letras + 3 digitos), normalizado para maiusculas.
- E-mail unico global (EmailRegistryService): responsavel de empresa, funcionarios de qualquer tenant e platform users. Bloqueia so novos registos; duplicados antigos nao foram alterados.
- AGT Modelo 8 (Regras e Requisitos para Validacao de Sistemas, ponto 34): assinatura RSA-1024 + SHA-1 (PKCS#1 v1.5), Base64 172 car. = campo Hash; texto assinado InvoiceDate;SystemEntryDate(AAAA-MM-DDTHH:MM:SS);InvoiceNo;GrossTotal;assinatura do documento anterior (vazio no 1.o). Chave = da PLATAFORMA (PlatformSigningService, RSA-1024 por omissao), nao por empresa. InvoiceNo passou a "FT A2026/0001" (igual ao SAF-T). Cadeias antigas SHA-256 recomecam automaticamente. Sem chave RSA-1024 valida a emissao cai no modo legado (sem assinatura AGT) e avisa no log.
- ACAO MANUAL: no Super Admin > Fiscal, gerar/rodar a chave RSA-1024, exportar public.txt e comunicar a AGT com a Declaracao Modelo 8 (nova versao da chave) ANTES de submeter novos SAF-T.
