# Roadmap de implementação (v1, 2026-11-07)

Ordem por impacto real nos clientes do Ndombaxi (mercado angolano, internet instável).

1. **Carrinho persistente fiável (B-01..B-05)** — `cartStore` sobre IndexedDB/kv, com rev/updatedAt, fusão local×servidor, aviso em vez de remoção silenciosa, testes unitários dos cenários de rede.
2. **Vendas suspensas e multi-carrinho (B-08)** — vários carrinhos por operador, suspender/retomar, persistidos.
3. **Idempotência mais estrita (B-06/B-07)** — op_id ligado a método+URL+utilizador; teste de reenvio.
4. **Testes de emissão** — pagamento duplicado, resposta perdida, stock concorrente (Cenários B e C).
5. **Fiscal** — confirmar requisitos AGT em fontes oficiais; teste de reconciliação SAF-T (Cenário E); bloquear emissão sem chave em produção.
6. **Funcionalidades competitivas** — atalhos de teclado documentados, SAF-T automático, monitor de cozinha, conta corrente de fornecedores (avaliar o que já existe antes).
7. **Segurança** — IDOR entre tenants e entre caixas, permissões de NC (Cenário D), documento finalizado imutável (Cenário G).
8. **UX do POS** e QA visual.

Cada etapa: alteração → typecheck/testes → commit → atualizar estes documentos. Produção, migrations destrutivas e AGT só com autorização.
