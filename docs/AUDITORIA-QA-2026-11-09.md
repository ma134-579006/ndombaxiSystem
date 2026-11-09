# Auditoria QA, carga e pentest — Ndombaxi System / LPS Vendas (2026-11-09)

Branch `qa/auditoria-total`. Todos os testes correram **só em localhost**: API local + PostgreSQL 16 portátil (zonky, Maven Central), com dados sintéticos de domínio `.qa.test`. Produção só recebeu pedidos de leitura leves (`/health`, cabeçalhos, TLS e o pré-pedido CORS). Os scripts estão em `qa/` e recusam correr fora de localhost.

## 1. Resumo executivo

**Estado inicial.** Base madura e muito trabalhada: numeração fiscal com `FOR UPDATE`, locks ordenados, idempotência por `client_op_id` e assinatura AGT RSA-1024/SHA-1. Encontrei, no entanto, falhas graves nos caminhos de **sincronização offline e replicação**, que estavam menos testados do que o POS online.

**Principais problemas (corrigidos):**

| ID | Sev. | Módulo | Problema |
|---|---|---|---|
| B-01 | Crítica | sync | `/sync/push` aceitava a venda sem validação: `unitPrice` imposto, quantidades negativas (total negativo, stock a subir), linhas livres de valor arbitrário, NC pedida pelo caixa e série à escolha |
| B-02 | Crítica | sync | Falha momentânea (base em baixo, deadlock, timeout) gravada no livro como **recusa definitiva**: o posto descartava a venda ou o fecho de turno |
| B-03 | Crítica | fiscal / servidor local | No servidor local do posto, a série do registo LOCAL ("A1", "A2"…) ganhava à série própria `L…` e colidia com as séries da nuvem. Com `invoices.number` único, a replicação recusava e o posto marcava como enviada: **a fatura faltava na nuvem e no SAF-T** |
| B-04 | Alta | replicação | Com uma sessão de caixa, `/replication/push` injetava movimentos de stock positivos de qualquer artigo (ex.: "+1 000 000"), o que a aplicação recusa a esse papel |
| B-05 | Alta | POS / crédito | Devolução de uma venda a crédito já parcialmente paga: o excedente pago pelo cliente desaparecia (NC 616 Kz; a dívida só descia 462) |
| B-06 | Alta | infra | Arranque de produção com `prisma db push --accept-data-loss`: uma alteração de schema apagava dados em silêncio |
| B-07 | Alta | segurança | Sem `trust proxy` no Render, o limite de pedidos por IP era partilhado por todos os clientes atrás do balanceador |
| B-08 | Média | segurança | Login, PIN, reset, 2FA e aprovação de desconto só tinham o limite global (100/min): ~6 000 PINs por hora |
| B-09 | Média | performance | 13 verificações de coluna por `information_schema` (~38 ms de planeamento cada), uma delas DENTRO da transação da venda que segura o lock da série fiscal |
| B-10 | Média | segurança | Seed de produção podia criar o Super Admin com a senha por omissão, que é pública no código |
| B-11 | Crítica (dep.) | apps Android | Capacitor 6.2.1, CVE crítica (conteúdo remoto carregado na origem da app); ainda `dompurify` (POS) e `proxy-addr` (API) |

**Resultado:** **APROVADO COM RISCOS RESIDUAIS** (secção 7).

## 2. Cobertura

- **Inventário:** 9 apps (api, web, pos, store, desktop, local-server, mobile, mobile-shell, store-shell), 8 packages, 53 módulos de API e 541 endpoints.
- **Ambiente de teste:** 2 empresas (tenants). A empresa A tem sede/distribuidora, 3 supermercados, 2 lojas de retalho e 1 armazém (8 lojas no total). A empresa B, de serviços, serve para testar o isolamento. 21 utilizadores cobrem todos os papéis reais do RBAC (COMPANY_ADMIN, REGIONAL_MANAGER, STORE_MANAGER, SHIFT_SUPERVISOR, CASHIER, ATTENDANT). Contabilista, compras e auditor **não existem** como papéis no sistema e foram mapeados para o papel real mais próximo. Há ainda 1 500 produtos (IVA 14 % e isentos M10/M11, 4 unidades, marcas, margens de 8 a 60 %), 1 200 clientes, 8 fornecedores, ~5 600 entradas de stock e **8 243 documentos fiscais** emitidos.

| Suíte | Execuções | Passaram | Falharam | Notas |
|---|---|---|---|---|
| Cenários de negócio + invariantes (`qa/cenarios.mjs`) | 69 | 68 | 1 | F-4: 10 documentos emitidos antes de se gerar a chave AGT de teste (esperado) |
| Conformidade AGT (`qa/agt.mjs`) | 16 | 16 | 0 | |
| Varrimento RBAC dinâmico (`qa/rbac-sweep.mjs`) | 498 chamadas / 249 rotas de escrita | — | 0 | ATTENDANT: nenhuma escrita aceite (só limpar o próprio histórico de IA); 0 respostas 5xx |
| API (jest) | 282 | 282 | 0 | inclui 7 testes novos |
| agt-xml | 51 | 51 | 0 | |
| offline-core | 12 | 12 | 0 | o script `pnpm test` falha no Windows por invocação (`node --test pasta/`), não por código |
| POS (carrinho) | 15 | 15 | 0 | |
| Builds | web, pos, store, api | OK | — | typecheck de desktop e local-server OK |
| Carga | 10/50/100/250 VUs + soak 5 min | — | — | ver secção 4 |

Coberto pelos cenários: venda a numerário com troco, a cartão, mista (com recusa se não somar o total), a crédito (com e sem cliente), pagamento parcial e acima da dívida, descontos (sem PIN, com PIN de supervisor, com PIN errado, 100 %), quantidade negativa, produto inexistente, preço imposto, NC pedida pelo caixa, duplo clique (6× o mesmo `clientOpId`), duas caixas a disputar a última unidade, venda sem stock, anulação (permissões, stock, estorno, dupla anulação), devolução parcial (excesso, repetida, crédito), reforço, sangria, fecho com conta X, numeração sem saltos, cadeia de hash, totais = soma das linhas, stock = soma dos movimentos, stock negativo, isolamento entre empresas, JWT adulterado e `alg=none`, escalada de papel e injeção SQL/XSS na pesquisa.

**Não testado (bloqueado ou fora do alcance):** validação contra o XSD oficial SAF-T AO (não está no repositório); comunicação real com a AGT, EMIS e Multicaixa (exigiria credenciais reais); impressoras físicas; instalador Windows e APK num aparelho real; servidor local desligado da rede num posto físico; ecrãs autenticados no browser (o Claude in Chrome estava desligado).

## 3. Bugs

| ID | Causa raiz | Evidência | Correção | Validação |
|---|---|---|---|---|
| B-01 | `PushOpItemDto.payload` era `IsObject` e o `applySale` passava `p.lines` em bruto ao `InvoiceService.emit` | leitura de `push.service.ts`: o emit aceita `unitPrice` e linhas livres | `sanitizeSalePayload` usa o MESMO `EmitInvoiceDto` (whitelist); docType FT/FS; série do posto; `DiscountGuard` com `offline: true` | `push.service.spec.ts` (4 testes novos) |
| B-02 | o `catch` do `applySale`/turnos/caixa gravava qualquer erro como `rejected` | idem | `isPermanentRejection` (HttpException 4xx ou SQLSTATE 22/23); o resto fica sem resultado e o motor do posto repete | testes "falha MOMENTÂNEA" e "22P02" |
| B-03 | `deviceSeries ?? localSeries()`: no servidor local o registo do posto aloca "A<n>" de um contador LOCAL | `devices.service.ts` (prefixo `A`), `invoices_number_unique`, o motor local marca as recusas como sincronizadas | `localSeries() ?? deviceSeries` no POS e na sincronização | `pos.controller.spec.ts` (2 testes novos) |
| B-04 | a política `SALES_PUSH` inclui `stock_movements` sem validar o sinal nem a origem | cenário R-1 (antes aplicava) | entrada só com `reference_id` de fatura anulada ou com NC | R-1 (recusa), R-2 (devolução legítima aceite) |
| B-05 | `original_amount = GREATEST(paid, original − refund)` sem estornar o excedente | cenário D-5: NC 5 228,04; pago 3 921,03; ficou 2 614,02 | o excedente sai como REFUND em numerário no turno | D-5 e C-1 (o fecho bate ao cêntimo) |
| B-06 | `startCommand` do `render.yaml` | ficheiro | sem `--accept-data-loss` (se o push falhar, o Render mantém a versão anterior) | revisão |
| B-07 | sem `app.set('trust proxy')` | `x-ratelimit-*` em produção; `main.ts` | `TRUST_PROXY_HOPS` (Render = 1 por omissão) | typecheck |
| B-08 | só o ThrottlerGuard global | `auth.controller.ts` | `@Throttle` 20/min (`AUTH_RATE_LIMIT_PER_MIN`) em 11 pontos | o QA recebeu 429 ao fim de 20 logins/min |
| B-09 | vista `information_schema.columns` | `EXPLAIN ANALYZE`: planning 37,9 ms → 0,2 ms | `pg_attribute` + `to_regclass(current_schema)` | equivalência provada em 6 casos; cenários verdes |
| B-10 | `SUPER_ADMIN_PASSWORD ?? 'ChangeMe!Admin2025'` | `prisma/seed.ts` | em produção não cria com a senha por omissão nem com menos de 12 caracteres | revisão |
| B-11 | versões antigas | `pnpm audit` | Capacitor 6.2.3 (mobile-shell e store-shell); overrides de dompurify 3.4.17 e proxy-addr 2.0.8 | install e builds OK |

Correções no simulador, não no sistema: o PIN gerado de forma não determinística e a contabilidade da gaveta, que não contava o estorno da anulação.

## 4. Performance

Máquina: Intel i5 M520 (2010), 4 núcleos, 4 GB, com a API (1 processo Node) e o PostgreSQL no mesmo portátil. **Os números servem para comparar entre si, não representam o Render** (o plano free tem 0,1 CPU e 512 MB, cerca de 10× menos).

| Cenário | VUs | Pedidos/s | Vendas/s | Erros | p50 | p95 | p99 | CPU API | RAM API | CPU PG | Esperas por lock |
|---|---|---|---|---|---|---|---|---|---|---|---|
| série única "A" | 10 | 13 | 5,2 | 0 % | 195 ms | 1,5 s | 2,1 s | 116 % | 127 MB | — | 0 |
| série única "A" | 50 | 23 | 9,3 | 0 % | 1,6 s | 4,9 s | 5,6 s | 145 % | 160 MB | 87 % | 4 |
| série única "A" | 100 | 21 | 10,2 | 0 % | 3,8 s | 7,4 s | 9,5 s | 171 % | 163 MB | 215 % | 4 |
| série única "A" | 250 | 24 | 10,2 | **8,1 % (503)** | 4,3 s | 17,6 s | 18,6 s | 122 % | 194 MB | 140 % | 4 |
| série por posto | 50 | 28 | 11,9 | 0 % | 1,5 s | 3,8 s | 4,3 s | 208 % | 202 MB | 193 % | 1 |
| série por posto | 100 | 30 | 12,3 | 0 % | 3,2 s | 5,9 s | 7,6 s | 196 % | 201 MB | 219 % | 0 |
| série por posto | 250 | 29 | 13,8 | **0 %** | 7,2 s | 17,8 s | 18,4 s | 176 % | 206 MB | 216 % | 0 |
| soak 5 min | 60 | 27 | 10,7 | 0 % | 2,0 s | 4,5 s | 5,9 s | 204 % | 195 MB | 223 % | 2 |

- **0 deadlocks** em todas as corridas (`pg_stat_database`).
- **Ponto de saturação:** cerca de 10 vendas/s com uma só série. Todas as vendas da empresa serializam no lock da linha `fiscal_series` e no lock da cadeia de auditoria. Com 250 VUs, o pool esgota-se e aparecem 503 (recusa limpa: nada incoerente na base, e o posto repete com o mesmo `clientOpId`).
- **Com série por posto** (registo de cada caixa, já suportado): as esperas por lock caem para 0, desaparecem os 503 e o débito sobe cerca de 35 %. Daí para cima o limite é o CPU da máquina.
- **Soak:** a RAM fica estável à volta de 195–206 MB, sem sinal de fuga de memória.
- **Integridade sob carga:** depois de ~8 000 documentos concorrentes, a numeração não tem saltos, a cadeia de hash está íntegra, os totais estão corretos, os 12 000 saldos de stock batem com a soma dos movimentos e não há stock negativo.
- 1 000 VUs não foram corridos: a saturação apareceu a 250 nesta máquina.
- **Gargalos a seguir:** (1) lock da série única, que se resolve com séries por posto; (2) `pg_advisory_xact_lock` da cadeia de auditoria por empresa (serializa todas as ações auditadas); (3) API num só processo Node; (4) ~50 queries por venda. Para a escala de um Shoprite são precisos planos pagos (CPU dedicado) e séries por posto.

## 5. Pentest

**Ferramentas usadas:** gitleaks 8.21.2 (793 commits, **0 fugas**), `pnpm audit`, varrimento RBAC próprio, cenários de injeção, JWT e isolamento, curl/openssl para cabeçalhos, TLS e CORS, e revisão manual do código (auth, RBAC, sync, replicação, pagamentos, XSS).

**Indisponíveis:** Semgrep (sem wheel para Python 3.14 no Windows), OWASP ZAP, Burp, Nmap, Metasploit e Trivy (não instalados; não instalei software de ataque sem necessidade). Nmap a produção ficaria fora do âmbito autorizado.

| Achado | Sev. | Estado |
|---|---|---|
| B-01, B-04 (fraude de preço e de stock por sincronização ou replicação) | Crítica/Alta | corrigido |
| B-07, B-08 (limites por IP partilhados; força bruta de PIN) | Alta/Média | corrigido |
| B-10 (Super Admin com senha por omissão) | Média | corrigido |
| B-11 (dependências críticas: Capacitor, dompurify, proxy-addr) | Crítica | corrigido |
| `xlsx` 0.18.5 (prototype pollution e ReDoS) na importação | Alta | **residual**: a versão corrigida só existe no CDN da SheetJS. O alcance limita-se a gestores autenticados que carreguem ficheiros |
| `multer` (DoS) | Alta | não alcançável: a API não usa `FileInterceptor` (uploads em JSON base64) |
| `nodemailer` 6 (injeção CRLF em cabeçalhos) | Média | residual: os campos vêm da configuração do Super Admin |
| Expo/RN (`tar`, `xmldom`, `shell-quote`…) | Alta/Crítica | ferramentas de BUILD da app `mobile` (não vão para o runtime) |
| CORS aceita `*.pages.dev`, `*.vercel.app`, `*.netlify.app` com `credentials` | Baixa | sem cookies de sessão (Bearer); um atacante não obtém tokens. Recomenda-se restringir |
| Produção: HSTS, CSP restritiva, X-Frame-Options, nosniff, TLS 1.3, 301 HTTP→HTTPS; CORS recusa origens estranhas | OK | — |
| Injeção SQL na pesquisa; JWT adulterado ou `alg=none`; acesso a faturas de outra empresa | OK | recusados |

## 6. Design e UX

Sem alterações de interface. A validação visual (320–1920 px) ficou **bloqueada**: o Claude in Chrome não estava ligado e a regra do projeto exige Chrome para testes visuais. Os builds web, pos e store passam. Fica por fazer: passar os ecrãs da landing, login, loja e (com sessão) painel e caixa nas larguras 320/360/375/390/768/1024/1366/1920.

## 7. Estado final e riscos residuais

**APROVADO COM RISCOS RESIDUAIS.** Não é uma declaração de sistema sem bugs nem 100 % seguro.

1. **AGT — documentos emitidos offline pelo servidor local não levam assinatura RSA.** A chave privada da plataforma está só na nuvem, por isso o posto emite em modo legado (SHA-256). Isto exige uma decisão do dono (chaves por posto declaradas à AGT? emissão sempre online?) e a confirmação com a AGT.
2. **AGT — a chave da plataforma em produção não foi verificada** (sem acesso à base de produção). Sem ela, a emissão cai em modo legado e só fica um aviso no log. A rotação da chave pelo Super Admin invalida a verificação contra a chave declarada.
3. **Replicação com sessão de caixa:** continua a aceitar `invoices`/`cash_movements`/saídas de stock sem verificação criptográfica (é o desenho do servidor local, que é de confiança). As linhas recusadas são descartadas pelo posto, por isso qualquer endurecimento adicional tem de ser coordenado com uma versão nova da app.
4. **Série única "A"** limita a ~10 vendas/s por empresa nesta máquina (bastante menos no Render free): ativar séries por posto em todas as caixas.
5. **Recebimentos de contas a receber em numerário** não entram no turno de caixa (é um registo de back-office). Confirmar se é o comportamento desejado.
6. `xlsx`, `nodemailer` e o CORS com sufixos de alojamento grátis (secção 5).
7. **`render.yaml` só tem efeito se o Blueprint estiver sincronizado.** Confirmar no Render que o *Start Command* do serviço já não tem `--accept-data-loss`, e definir `TRUST_PROXY_HOPS` (1, ou 2 se a cadeia incluir o Cloudflare).

## Como repetir

```bash
node qa/pg-local.mjs           # alternativa leve (PGlite) — só para smoke, não para concorrência
QA_STATE=qa/.state.json node qa/seed-empresa.mjs 1500 1000
node qa/cenarios.mjs
QA_SUPER_PASS=... node qa/agt.mjs
node qa/rbac-sweep.mjs
QA_DEVICES=1 node qa/carga.mjs 30 10,50,100,250,500,1000
```
