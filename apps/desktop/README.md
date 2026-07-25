# Ndombaxi System — Aplicação Windows

Aplicação instalável que empacota **os mesmos frontends do website**: o Painel de
Gestão (`apps/web`) e a Caixa/POS (`apps/pos`). Não existe interface própria aqui
— é essa a razão pela qual a app nunca diverge do site.

> **Regra permanente:** qualquer alteração ao website tem de ser refletida nesta
> aplicação (e nas versões Android/iOS). Ver a memória
> `feedback_apps_sync_with_website.md`.

A **Loja Online não é empacotada**: é a montra do cliente final e vive no
navegador. As apps instaláveis são ferramentas de trabalho — gerir e vender.

## Como funciona por dentro

| Peça | Escolha | Porquê |
|---|---|---|
| Interface | `apps/web` e `apps/pos` compilados, servidos do disco | Sincronização estrutural com o site, não manual |
| Protocolo | `ndombaxi://` registado como `secure: true` | `file://` não é contexto seguro → não haveria `crypto.subtle` → não haveria cifra nem PIN offline |
| Base local | SQLite, `WAL` + `synchronous=FULL` | A venda só é dada como gravada depois de o disco confirmar |
| Segredo do posto | `safeStorage` (DPAPI do Windows) | Ligado à conta da máquina: copiar o ficheiro para outro PC não serve de nada |
| Motor offline | `@nexus/offline-core` | O mesmo motor das versões Android e iOS |
| Isolamento | `contextIsolation` + `sandbox`, sem `nodeIntegration` | Uma dependência npm comprometida no frontend não alcança o disco |

## Compilar

```bash
pnpm --filter @nexus/desktop build
```

Isto compila o processo principal, compila os dois frontends com a API de
produção e copia-os para `resources/modules/`.

Gerar o instalador (Windows 10/11, x64):

```bash
pnpm --filter @nexus/desktop dist:win
```

O resultado fica em `release/NdombaxiSystem-Setup-<versão>-x64.exe`.

## Verificação automática

```bash
cd apps/desktop && ./node_modules/.bin/electron scripts/smoke.js
```

Nove verificações que correm dentro do Electron real: módulos empacotados,
durabilidade e atomicidade do SQLite, persistência entre reinícios, cofre do SO,
carregamento do frontend, contexto seguro com AES-GCM a funcionar, superfície do
`preload` (confirma que `require` e `process` NÃO chegam ao frontend) e ausência
de erros de código na consola.

## Limitação conhecida: tipos de letra offline

Os três frontends carregam as fontes (Sora, DM Sans) do Google Fonts por rede.
Num posto **sem internet**, o navegador cai para a fonte do sistema — tudo
funciona, mas o aspeto não é 100 % idêntico ao do site.

A correção certa é descarregar as fontes e servi-las localmente a partir de
`apps/web/public` e `apps/pos/public`, trocando o `<link>` do Google por um
`@font-face` local. Beneficia também o site (uma ligação externa a menos, página
mais rápida). Ainda **não está feito**.

## Notas de instalação conhecidas

- **SmartScreen.** Sem certificado de assinatura de código, o Windows mostra um
  aviso na primeira instalação. Resolve-se com um certificado EV de uma
  autoridade reconhecida; o `electron-builder.yml` já tem o local onde entra.
- **Desinstalar não apaga dados.** `deleteAppDataOnUninstall: false` é
  deliberado: uma desinstalação acidental não pode levar consigo vendas que
  ainda não subiram para o servidor.
- **MAX_PATH do Windows.** O pnpm baptiza as pastas do seu armazém virtual com
  o pacote *mais todos os seus pares*, gerando nomes como
  `app-builder-lib@25.1.8_dmg-builder@25.1.8_electron-builder-squirrel-windows@25.1.8`.
  Somado à profundidade deste repositório, o caminho de um template do NSIS
  chegava a **262 caracteres** — dois acima do limite de 260 do Windows — e o
  `makensis` abortava com `could not open file`.
  A correção permanente está em `.npmrc` (`virtual-store-dir-max-length=60`) e
  aplica-se no próximo `pnpm install`. Junções e `subst` **não** resolvem: o
  Node resolve sempre para o caminho físico real.
- **Reconstrução nativa desligada.** O `better-sqlite3` é compilado à parte
  contra o ABI do Electron (`prebuild-install --runtime=electron
  --target=33.4.11`). O `npmRebuild` do electron-builder percorre o workspace
  pnpm inteiro e falha no primeiro symlink de uma dependência de testes ausente.

## Atualizações

A app pergunta ao servidor, em segundo plano, se há versão nova
(`GET /downloads/latest?platform=windows`). Se houver, mostra o ecrã de
atualização; se for obrigatória, bloqueia o acesso.

O botão de atualizar leva **sempre à página oficial de downloads do site** —
nunca ao link direto do Drive/Mega. O link de armazenamento é gerido no Super
Admin e nunca aparece à frente do cliente: é na página oficial que estão o hash
e a assinatura que provam que o ficheiro não foi trocado no caminho.
