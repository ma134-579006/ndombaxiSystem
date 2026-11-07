# Lacunas de conformidade AGT (v1, 2026-11-07)

**O Ndombaxi System não é declarado certificado nem validado pela AGT neste documento.** As fontes oficiais ainda não foram consultadas nesta auditoria; os requisitos abaixo vêm do que o código e o `AGENT-HANDOFF.md` documentam e ficam por confirmar contra a legislação e as regras técnicas publicadas pela AGT.

| Requisito | Fonte oficial | Estado atual | Falha / dúvida | Correção | Teste | Evidência |
|---|---|---|---|---|---|---|
| Assinatura RSA dos documentos (Hash) | AGT, "Regras e Requisitos para Validação de Sistemas" (Modelo 8, ponto 34) — citado no handoff, a confirmar | Implementado (RSA-1024 + SHA-1, chave da plataforma) | Sem chave válida a emissão cai em modo legado sem assinatura | Bloquear emissão sem chave em produção, ou alertar no painel | Por criar | `fiscal-signing.service.ts`, `platform-signing.service.ts` |
| Comunicação da chave pública | Declaração Modelo 8 (a confirmar) | Pendente | Ação manual do proprietário | Gerar chave, exportar `public.txt`, entregar à AGT | n/a | handoff |
| Numeração sequencial por série | A confirmar | Implementado com `FOR UPDATE` | Séries por posto: confirmar aceitação AGT | — | Por criar | `invoice.service.ts:436` |
| NC e anulação | A confirmar | Anulação por NC; NC limitada ao vendido | — | — | Por criar | `invoice.service.ts:1156` |
| SAF-T AO | A confirmar | Exportação existe | Reconciliação com documentos não testada | Teste de reconciliação (Cenário E) | Por criar | `saft.service.ts` |
| Faturação eletrónica / comunicação | A confirmar | `einvoice/`, `agt-communication.service.ts` existem | Estado real UNVERIFIED | Auditar | Por criar | |
| QR code no documento | A confirmar | Recibo com QR (handoff) | Conteúdo exigido não confirmado | Auditar | Por criar | `ReceiptModal.tsx` |

Dependências externas: chave e declaração junto da AGT, processo formal de certificação — só com autorização do proprietário.
