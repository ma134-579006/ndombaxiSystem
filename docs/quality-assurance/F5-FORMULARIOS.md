# F5 — Formulários (2026-11-26)

## Engenharia reversa
- Formulários da Gestão: `<Modal>` (`components/ui.tsx`) com o padrão `<div class="field"><label>Rótulo</label><input/></div>` (~460 ocorrências). Os formulários em página (Produtos) usam `.vd-row > .vd-lbl` + `.vd-ctl`.
- Só 19 de 614 `<label>` têm `htmlFor`: **o rótulo visível não está ligado ao campo**. O leitor de ecrã anuncia só «campo de texto» e tocar no rótulo não foca o campo (QA-017).
- Proteção contra duplo envio: os botões de gravar ficam `disabled` enquanto gravam (estado `saving`). Validação de campos obrigatórios antes do pedido (toast).
- A captura de rascunhos (`workspace.ts`) usa o `id` do campo como chave, por isso a correção não pode mexer nos `id` dos campos.

## Correção
- `fieldLabels.ts` (Gestão e Caixa, instalado em `main.tsx` como o `modalClose.ts`): liga cada `.field > label` e `.vd-row > .vd-lbl` aos campos sem nome acessível por `aria-labelledby` (o id vai para o RÓTULO), e o toque no rótulo foca o campo. Não altera rótulos com `for` nem campos com `aria-label` próprio.

## Testes executados — `qa/formularios.mjs`
Secções: Clientes, Produtos, Fornecedores, Gastos, Funcionários, Utilizadores, Lojas, Promoções, Férias, Faturas de compra; em desktop (1366) e telemóvel (390), Chromium. Verifica: F1 nomes acessíveis; F2 sem scroll lateral; F3 submeter vazio não grava; F4 duplo clique em gravar envia **uma só** escrita (dados «QA F5 …», só em desktop).

| Alvo | Resultado |
|---|---|
| main (antes) | F1 falha em **todos** os formulários (ex.: Clientes 7/7 campos sem nome, Funcionários 12/12); F2, F3 e F4 PASS |
| correção | **70/70 PASS** (10 secções × desktop/telemóvel; F4 só em desktop) |

Resultados de integridade: nenhum formulário gravou vazio; duplo clique → um só pedido (ex.: `POST /pos/products 201` ×1, `POST /promotions 201` ×1). Nalguns formulários o preenchimento automático não satisfez a validação (nenhuma escrita): aí o F4 confirma só que não houve duplicado.

## Não verificado
- Leitor de ecrã real (VoiceOver/TalkBack): verificado só o nome acessível no DOM.
- Formulários fora destas 10 secções: cobertos pelo instalador global, mas sem varredura dedicada.
