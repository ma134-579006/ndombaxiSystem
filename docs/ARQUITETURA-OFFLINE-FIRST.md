# Arquitetura offline-first — a base local como fonte de verdade

> Requisito do dono do produto (03/08/2026): durante a operação diária, o
> **servidor local é a fonte primária**. O Aiven serve para sincronizar entre
> dispositivos, backup, recuperação, acesso remoto e replicação — **nunca** para
> concluir uma operação do dia-a-dia.

Este documento existe porque a parte difícil deste requisito não é a base de
dados local. É a **sincronização**, e nela há uma restrição que decide tudo o
resto. Quem for implementar isto deve ler a secção seguinte antes de escrever
uma linha.

---

## 1. A restrição que decide a arquitetura: a cadeia de hash fiscal

Em `apps/api/src/pos/invoice.service.ts`, cada documento fiscal é numerado assim:

```
SELECT last_sequence, last_hash FROM fiscal_series
 WHERE doc_type = ? AND series = ? AND year = ?  FOR UPDATE
        ↓
sequence = last_sequence + 1
hash     = SHA256( cabeçalho_do_documento , last_hash )   ← encadeado
```

Ou seja: **cada fatura contém o hash da fatura anterior da mesma série**. É o que
a AGT exige e o que torna impossível adulterar o histórico — mas também o que
torna a série **estritamente sequencial e com um único escritor**.

### A consequência, dita sem rodeios

Se dois postos emitirem faturas **na mesma série** enquanto estão offline, cada
um constrói a sua cadeia a partir do mesmo `last_hash`. Ficam duas cadeias
divergentes com a mesma numeração:

```
Posto 1 (offline):  … → FT A/2026/57 (hash X) → FT A/2026/58 (hash Y)
Posto 2 (offline):  … → FT A/2026/57 (hash Z) → FT A/2026/58 (hash W)
                            ↑ mesmo número, documentos diferentes
```

Isto **não tem resolução de conflitos possível**. Renumerar um dos lados muda o
cabeçalho, muda o hash, e invalida o hash de todos os documentos seguintes — a
cadeia inteira deixa de verificar. Nenhuma política de "última escrita ganha",
de versões ou de timestamps resolve isto, porque o problema não é escolher um
vencedor: é que ambos os documentos são **legalmente válidos e já foram
entregues ao cliente**.

### A solução (a única correta): uma série por posto

Cada posto emissor recebe a **sua própria série fiscal**:

| Posto | Série | Numeração |
|---|---|---|
| Loja 1 · Caixa 1 | `A1` | FT A1/2026/0001, 0002, … |
| Loja 1 · Caixa 2 | `A2` | FT A2/2026/0001, 0002, … |
| Telemóvel do gerente | `A3` | FT A3/2026/0001, … |

Com isto:

- cada cadeia tem **um só escritor** e é sempre **append-only**;
- a sincronização passa a ser uma **união de inserções** — nunca há duas versões
  da mesma linha, logo **não há conflitos a resolver** nos documentos fiscais;
- é assim que qualquer sistema de POS multi-terminal sério funciona, e a AGT
  admite múltiplas séries por tipo de documento.

**Regra a gravar:** documentos fiscais nunca são "sincronizados" no sentido de
fundidos. São **replicados**. O conflito é evitado por construção, não resolvido
depois. Tentar resolvê-lo depois é onde estes sistemas se perdem.

---

## 2. O que já existe (medido, não suposto)

| Peça | Estado |
|---|---|
| Motor fiscal `@nexus/agt-xml` | **Portátil**: zero dependências externas, 5 ficheiros de teste. Só usa `node:crypto` (SHA-256 e RSA) — substituível por WebCrypto. |
| API + PostgreSQL por empresa | Schema por empresa, `FOR UPDATE`, índices únicos **parciais** (é deles que depende a impossibilidade de duplicar faturas). |
| Servidor local (`apps/local-server`) | PostgreSQL portátil + supervisor. Compila. Arranque ligado ao Electron, **com barreira** (`readiness.ts`): a base local nunca substitui a nuvem sem estar ligada de propósito **e** provisionada. |
| Idempotência | `client_op_id` com índice único parcial em `invoices`, `cash_sessions`, `cash_movements`. Reenviar a mesma operação é impossível duplicar. |
| Sync — subida | `sale`, `customer`, `cashSession`, `cashMovement`. |
| Sync — descida | Cursor incremental composto `(updated_at, id)`, 6 entidades de catálogo. |
| Fila offline | Existe no cliente (IndexedDB / SQLite via `@nexus/offline-core`). |

**Tradução:** as fundações certas já estão lançadas — motor fiscal portátil,
idempotência imposta pela base de dados, sync incremental com cursor. O que
falta é cobertura e o sentido inverso.

---

## 3. O que falta, por ordem de importância

### 3.1 Série por posto (bloqueia tudo o resto)

Sem isto, nada do resto pode ser ligado em produção com dois pontos de venda.

- Registo de dispositivos: cada posto tem `device_id` estável e uma série própria.
- Atribuição da série no primeiro arranque (e comunicação à AGT).
- Migração das empresas atuais: as séries existentes continuam válidas; os
  postos novos nascem com série própria.

### 3.2 Stock por movimentos, nunca por valor absoluto

Um erro clássico e caro: sincronizar `stock = 40`. Dois postos offline vendem 3
e 5; ao sincronizar, um escreve 37, o outro 35, e um dos lados desaparece.

**Sincronizar sempre o movimento (`-3`, `-5`), nunca o saldo.** Movimentos são
comutativos: somam-se em qualquer ordem e dão o mesmo resultado. A tabela
`stock_movements` já existe — o saldo passa a ser **derivado**, não replicado.

### 3.3 Metadados de sincronização em todas as entidades

Cada registo sincronizável precisa de: `uuid` global, `created_at`,
`updated_at`, `device_id` de origem, `user_id`, `version` (inteiro que sobe a
cada alteração) e `sync_state`. Hoje existe para parte; falta uniformizar.

### 3.4 Política de conflitos — explícita e por classe de dados

| Classe | Exemplos | Política |
|---|---|---|
| **Append-only fiscal** | faturas, notas de crédito, turnos, movimentos de caixa | **Sem conflitos por construção** (série por posto). União de inserções. |
| **Aditivo** | movimentos de stock, consumos | **Soma**. Comutativo, sem perda. |
| **Catálogo** | produtos, clientes, preços, definições | **Última escrita ganha** por `(version, updated_at, device_id)` — com o desempate por `device_id` só para ser determinístico. **Todo o conflito é registado** numa tabela de auditoria com as duas versões, para nada se perder em silêncio. |
| **Exclusivo do servidor** | planos, subscrições, utilizadores | A nuvem manda. O posto só lê. |

### 3.5 Fila persistente com garantias

A fila tem de sobreviver a reinício, falta de energia e fecho forçado. Regras:
gravar a operação **antes** de responder ao utilizador; nunca apagar da fila
antes da confirmação do servidor; reenvio idempotente (o `client_op_id` já
garante que reenviar não duplica).

### 3.6 Motor de replicação local ↔ Aiven

Bidirecional, incremental, por lotes, com retoma. Corre em segundo plano e
**nunca** no caminho de uma operação do utilizador.

### 3.7 Android

O motor fiscal é portátil (zero dependências). A única barreira é `node:crypto`
→ WebCrypto. O SQLite suporta transações e índices únicos parciais, que é o que
a idempotência exige. Logo, é tecnicamente possível o Android emitir documentos
com **a mesma** lógica fiscal e série própria — sem reimplementar nada, que é o
que tornaria isto perigoso.

---

## 4. Fluxo alvo (o do requisito), anotado

```
Utilizador → Gestor/Caixa/Android
          → API Local → PostgreSQL local
          → COMMIT                          ← a operação está garantida AQUI
          → stock, caixa, dashboard, relatórios, SAF-T (tudo local, mesma transação)
          → fila de sincronização
          → responder "concluído"           ← o utilizador é libertado AQUI
          ─────────────────────────────────
          → (assíncrono) replicação com o Aiven
```

O ponto que nunca pode ser invertido: **o utilizador é libertado no commit
local**. A nuvem nunca está no caminho crítico.

---

## 5. Faseamento proposto

| Fase | Entrega | Risco |
|---|---|---|
| **0** | Barreira do servidor local | ✅ feito (PR #13) |
| **1** | Série por posto + registo de dispositivos | Médio — mexe em numeração fiscal |
| **2** | Servidor local a correr a sério: binários PostgreSQL + API empacotada, provisionamento inicial a partir do Aiven | Alto — empacotamento |
| **3** | Stock por movimentos + metadados de sync uniformes | Médio |
| **4** | Replicação bidirecional incremental + registo de conflitos | Alto |
| **5** | Fila persistente com as garantias acima, nas 3 apps | Médio |
| **6** | Android com motor fiscal local (WebCrypto + SQLite) | Alto |

A ordem não é negociável nos pontos 1→2: pôr um servidor local a emitir faturas
sem série própria é criar cadeias divergentes em produção — o único erro deste
projeto que **não tem correção possível depois de acontecer**, porque os
documentos já foram entregues aos clientes.
