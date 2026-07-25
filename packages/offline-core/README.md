# @nexus/offline-core

Motor Offline-First do Ndombaxi System. **Zero dependências de runtime** — o que
corre no posto de venda é exatamente o que corre nos testes.

Um só motor para as quatro superfícies: Windows (Electron), Android e iOS
(Capacitor) e os frontends web.

## A promessa, e como é cumprida

> *"Nenhum dado é perdido. Nunca. Nem com queda de energia, nem com crash, nem
> com a rede a oscilar. E nada entra duas vezes."*

| Promessa | Mecanismo | Onde |
|---|---|---|
| A venda sobrevive a um corte de energia | `enqueue()` só retorna depois de o disco confirmar (`synchronous=FULL` no SQLite; `oncomplete` da transação no IndexedDB) | `engine.ts`, `storage/` |
| Nada fica preso a meio de um envio | No arranque, toda a operação `INFLIGHT` volta a `PENDING` | `engine.ts` → `start()` |
| Nada entra duas vezes | `opId` (UUID v4) viaja com a operação; o servidor tem índice ÚNICO em `invoices.client_op_id` | `crypto.ts`, API `/sync` |
| Reenviar é seguro | Um reenvio devolve o resultado guardado, com o número fiscal original | API `push.service.ts` |
| Oito caixas não derrubam a API ao voltar a net | Recuo exponencial **com dispersão** | `backoff.ts` |
| "Sem internet" distingue-se de "servidor em baixo" | Sonda real ao `/health`, não o `navigator.onLine` | `net.ts` |
| Conflitos de dinheiro nunca se resolvem sozinhos | Política por entidade; fiscal e caixa vão para `BLOCKED` | `conflict.ts` |
| O disco roubado não entrega a empresa | AES-256-GCM com chave derivada do cofre do SO | `crypto.ts`, `session.ts` |
| O caixa entra sem rede | Verificador PBKDF2 do PIN + RBAC em cache com validade | `session.ts` |

## A melhor estratégia de conflitos é não os ter

O modelo de dados foi pensado em três famílias e **só uma pode conflituar**:

1. **Append-only** (vendas, notas de crédito, movimentos de caixa) — cada
   documento é novo. Duas caixas offline a vender o mesmo produto geram dois
   documentos. Conflito: impossível.
2. **Contadores** (stock, saldos, pontos) — nunca enviamos *"o stock passa a 7"*,
   enviamos *"−3"*. Somas comutam. Conflito: impossível. É por isto que
   `stockMove` existe como entidade em vez de um campo `stock`.
3. **Registos editáveis** (ficha de cliente, preço) — aqui sim. Só esta família
   precisa de política, e está em `ENTITY_POLICIES`.

## Uso

```ts
const storage = await pickStorage(sqlBridge);   // SQLite → IndexedDB → memória
const net = new NetMonitor({ healthUrl: `${API}/health` });
const engine = new SyncEngine({
  storage, net,
  transport: httpTransport({ baseUrl: API, getAuthHeader, getTenantCode }),
  entities: ['product', 'customer', 'promotion'],
});
await engine.start();

// Vender sem internet — devolve mal fique DURÁVEL em disco:
await engine.enqueue({ entity: 'sale', op: 'create', payload: venda });
```

## Testes

```bash
pnpm --filter @nexus/offline-core test
```

Onze testes, cada um com o nome do desastre que evita: corte de energia a meio
de um envio, reenvio após falha de rede, recusa de negócio, conflito fiscal,
registo apagado no servidor, regresso em massa de 120 vendas após semanas
offline, e reescrita de ids locais para ids do servidor.
