# Rebrand Ndombaxi System -> LPS Vendas (ramo `rebrand-lps-vendas`)

Estado: codigo e assets prontos NO RAMO; nada fundido em `main`, nada alterado em DNS, producao, OAuth, SAF-T ou base de dados.

## Mantido de proposito (tecnico / historico / compatibilidade)
- IDs: `com.ndombaxi.system`, `ndombaxi://`, chaves `ndombaxi.*`, bases IndexedDB `ndombaxi-*`, `window.ndombaxi`, `.ndbak`, `BACKUP_FORMAT`.
- Desktop: `userData` fixo em `%APPDATA%/Ndombaxi System` (preserva BD local, chave do dispositivo, definicoes); `artifactName NdombaxiSystem-Setup-*` (auto-update); pasta Documentos/Ndombaxi/Backups.
- SAF-T/AGT: `productId` `Ndombaxi System/Ndombaxi` e `sourceId` `Ndombaxi` (saft-builder, schema.prisma, einvoice.service) — nao alterar sem validacao AGT.
- Infra: `ndombaxi-api-3nmz.onrender.com`, servico/imagens `ndombaxi-api`, `NDOMBAXI_API_URL`.
- Autoria "Manuel Mbala Tomas Ndombaxi"; credenciais/e-mails de teste `@ndombaxi.ao`; AGENT-HANDOFF (registo historico); COMO-GERAR-SETUPS (nome da pasta local do utilizador).
- `apps/api/src/support/bot-model.json` nao retreinado.

## Pendente de configuracao externa (nao feito)
1. DNS/Cloudflare Pages: adicionar `lpsvendas.com` (+ www/loja/caixa) SEM remover `ndombaxisystem.com`.
2. OAuth Google: adicionar origens/redirects de lpsvendas.com (nao remover os antigos).
3. SMTP: remetente/dominio lpsvendas.com (SPF/DKIM/DMARC).
4. Depois de validado: virar as 33 referencias a `ndombaxisystem.com` no codigo (lista: `git grep ndombaxisystem.com`), canonical/og:url/sitemap, e 301 antigo -> novo.
5. Logo vetorial/PNG transparente: substituir os ficheiros interinos (mesmos nomes) — ver LEIA-ME.md desta pasta.
6. `apps/web/public/guides/*.png` (screenshots com marca antiga) e retreino do bot.
7. Base de dados: valores de marca (branding/site, nome do remetente) — listar registos exactos e pedir autorizacao antes de qualquer UPDATE; nao tocar historico/auditoria/documentos legais.
8. Higiene: 3 pastas `win-unpacked` (app.asar) estao versionadas no git — candidatas a remocao/.gitignore (decisao do dono).
