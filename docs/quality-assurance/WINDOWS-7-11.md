# App Windows — do Windows 7 ao 11 (2026-11-27)

Pedido do utilizador: «os apps entregar com suporte desde o Windows 7 ao 11».

## Situação antes
- O instalador do LPS Vendas usa o Electron 33, que só corre no Windows 10 e 11.
- No `package.json` havia o comando `dist:win-legacy`, mas o ficheiro `electron-builder-legacy.yml` a que apontava não existia: não havia instalador para Windows 7, 8 ou 8.1 (QA-041).
- O código do processo principal usava APIs que não existem no Electron 22 (o último que corre no Windows 7): `protocol.handle` e `net.fetch` (Electron 25+) e o `fetch` global (Node 18+; o Electron 22 traz o Node 16).
- A atualização obrigatória e o Admin → Aplicações só conheciam a plataforma `windows`. Uma app de Windows 7 seria mandada descarregar o instalador moderno, que nem abre nesse sistema.

## Solução: duas edições, o mesmo código
| | Moderna | Legado |
|---|---|---|
| Sistemas | Windows 10 e 11 (64 bits) | Windows 7, 8 e 8.1 (64 e 32 bits) |
| Electron | 33.4.11 | 22.3.27 |
| Configuração | `electron-builder.yml` | `electron-builder-legacy.yml` |
| Workflow | `windows-build.yml` → release `windows-latest` | `windows7-build.yml` → release `windows7-latest` |
| Plataforma (atualizações / Admin → Aplicações) | `windows` | `windows7` (64) e `windows7-32` (32) |
| Servidor local (PostgreSQL) | sim | não (o PostgreSQL 16 não corre no Windows 7): trabalha contra a nuvem, com a fila offline |

- `apps/desktop/src/main/compat.ts`: deteta a edição pela versão do Electron (`LEGACY`), escolhe a plataforma e fornece o `mainFetch` (`fetch` com reserva em `net.request`).
- `protocol.ts`: no legado serve os módulos com `registerBufferProtocol`, com a mesma barreira anti travessia de caminho, o mesmo recuo para o `index.html` e os mesmos cabeçalhos de segurança (CSP, `nosniff`, `no-referrer`).
- `preload` e as verificações de atualização da Gestão e da Caixa usam a plataforma da edição. A atualização obrigatória continua ativa nas duas edições: cada uma bloqueia quando é publicada uma versão mais nova DA SUA plataforma.
- API (`downloads`): aceita `windows7` e `windows7-32`. A sincronização com o GitHub lê a release `windows7-latest` (ficheiros `LPSVendas-Setup-win7-x64.exe` e `-ia32.exe`).
- Painel: Admin → Aplicações e a página de downloads mostram «Windows 7/8 (64 bits)» e «Windows 7/8 (32 bits)».
- Mesmo `appId`: quem passar do Windows 7 para o 10/11 instala a edição moderna por cima, sem perder os dados.

## Como gerar
Ativar uma vez: copiar `apps/desktop/ci/windows7-build.yml` para `.github/workflows/` (o token desta sessão não tem a permissão `workflow`). Depois: Actions → «Windows 7/8 build» → Run workflow (a partir da `main`). Gera os dois instaladores e publica-os na release `windows7-latest`; o servidor passa a exigir essa versão às apps legado.

## Testes
- Typecheck: desktop, Caixa e Gestão sem erros novos.
- `apps/desktop/scripts/smoke-legado.cjs` no Electron real (o mesmo teste nas duas edições; o caminho legado forçado com `NDOMBAXI_LEGACY=1` no Electron 33):

| Verificação | Legado (registerBufferProtocol) | Moderno (protocol.handle) |
|---|---|---|
| Edição detetada / plataforma de atualização | PASS (`windows7`) | PASS (`windows`) |
| Gestão carrega por `ndombaxi://` | PASS | PASS |
| CSP + `nosniff` | PASS | PASS |
| Travessia de caminho bloqueada | PASS (403) | PASS (403) |
| Rota SPA desconhecida → `index.html` | PASS | PASS |
| Tipo MIME dos scripts | PASS | PASS |
| Contexto seguro (`crypto.subtle`) | PASS | PASS |
| `window.ndombaxi.platform` no preload | PASS (`windows7`) | PASS (`windows`) |
| Caixa carrega por `ndombaxi://` | PASS | PASS |
| Erros de consola | nenhum | nenhum |

- UNVERIFIED: o arranque num Windows 7/8 real com o Electron 22.3.27 e o instalador gerado pelo workflow (nesta sessão não há máquina Windows 7 e o Electron 22 não foi descarregado). O primeiro build do workflow «Windows 7/8 build» e uma instalação num Windows 7 confirmam-no.
