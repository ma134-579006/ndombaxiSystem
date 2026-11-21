# Plano e resultados dos testes

Execução: 21-11-2026. Ambiente: máquina local, PostgreSQL 16 de QA (`127.0.0.1:55433`) e API em `127.0.0.1:3901`, com `AGT_FE_BASE_URL` a apontar para o simulador em `127.0.0.1:3996`. **Nenhum teste tocou na produção nem na AGT.**

## Como repetir

```bash
pnpm --filter @nexus/agt-xml test          # 76: assinaturas, JWS, FE, SAF-T XSD + semântica
pnpm --filter @nexus/api test              # 329: unitários/integração (inclui replicação fiscal, datas, E09)
# API local de QA com AGT_FE_BASE_URL=http://127.0.0.1:3996 (ver qa/restart-api.sh)
node qa/agt-fe-simulacao.mjs               # 30: simulação completa da Facturação Electrónica
node qa/fiscal-imutabilidade.mjs           # 14: ataques SQL directos (com ROLLBACK)
node qa/fiscal-emissao.mjs                 # 14: regras de emissão, replicação forjada, SAF-T validado
```

## Resultados

| Bateria | Total | Aprovados | Reprovados | Ignorados |
|---|---|---|---|---|
| `@nexus/agt-xml` (jest) | 76 | 76 | 0 | 0 |
| `@nexus/api` (jest) | 329 | 329 | 0 | 0 |
| `qa/agt-fe-simulacao.mjs` | 30 | 30 | 0 | 0 |
| `qa/fiscal-imutabilidade.mjs` | 14 | 14 | 0 | 0 |
| `qa/fiscal-emissao.mjs` | 14 | 14 | 0 | 0 |
| Regressões: `qa/auditoria.mjs` | 99 | 99 | 0 | 0 |
| Regressões: `qa/assistente-boas-vindas.mjs` | 12 | 12 | 0 | 0 |

Os relatórios JSON de cada execução ficam em `qa/out/`.

## Cenários cobertos

| Cenário | Testes |
|---|---|
| A: identidade do produtor | A-1…A-9: geração ≥ 2048, pública PEM, privada nunca devolvida, chave fraca recusada, assinatura certa / dados alterados / outra chave |
| B: integração API | B-1 (401), B-2 (500, 429, malformado), B-3 (aceitação de 34 documentos em lotes ≤ 30), B-4/B-5 (requestID e submissão registados), B-6 (rejeição E20) |
| C: séries | C-1 (rejeição E31), C-2 (códigos da AGT), C-3 (activação só com séries), D-3 (numeração contínua), FI-13 (unicidade) |
| D: facturação | D-1/D-2 (FT e FR na série AGT, com NOR, isento M10, valores pequenos 0,07 e descontos), D-4 (NC por anulação), E-1…E-6 |
| E: SAF-T de Facturação | XSD válido; 7 negativos de XSD; 12 negativos semânticos; E-11/E-12 com dados reais da API |
| F: SAF-T de Contabilidade | Não executado: o sistema não tem contabilidade (ver SAF-T.md) |
| G: SAF-T de Inventário | Não executado: o formato oficial não está publicado |
| H: contingência e recuperação | H-1…H-3 (resposta perdida → E09 → reconciliado, sem duplicado), H-4 (reinício a meio do envio), I-1…I-3 (art. 17.º), E-7/E-8 (fila offline) |
| I: segurança | FI-1…FI-14, E-9/E-10 (replicação forjada), A-2/A-4/A-7/I-4 (segredos), E-14 (NIF provisório) |

## Erros reais encontrados pelos testes

- **Facturas perdidas na FE.** A simulação revelou que a 1.ª factura emitida no segundo da activação nunca era comunicada. Corrigido: a recolha deixou de filtrar pela data de entrada truncada ao segundo.
- **Bloqueio dos 60 dias por dias inteiros.** Contava 60,96 dias como 60. Corrigido para o tempo exacto ("mais de 60 dias").

## Limitações

- O simulador segue a documentação publicada, que tem contradições (header `typ`, campos do exemplo). O comportamento real só se confirma em homologação.
- Não houve testes em homologação: faltam as credenciais.
- Sem medição de cobertura de código: não está configurada no projecto.
- Não ficaram testados com casos dedicados: fusos horários (o servidor fixa Luanda), documentos com centenas de linhas e valores muito elevados.
