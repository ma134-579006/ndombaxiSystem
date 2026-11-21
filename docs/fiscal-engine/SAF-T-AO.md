# SAF-T (AO)

## SAF-T do Vendus

- `GET /taxauthority/saft/?year=&month=` → `{year, month, xml}` (XML em Base64).
- O LPS descodifica e valida no **XSD SAFTAO1.01_01** (o mesmo validador libxml2 da
  auditoria anterior). Também confirma o namespace
  `urn:OECD:StandardAuditFile-Tax:AO_1.01_01` e o NIF do ficheiro contra o da empresa.
- Arquiva tudo em `fiscal_engine_saft`: período, XML, SHA-256, resultado XSD, problemas,
  cabeçalho e data. Fica com histórico e download.
- Um ficheiro português (namespace PT) ou de outro NIF é marcado como inválido, com o
  motivo.

## O que não está confirmado

- **Não se sabe** se o ficheiro do Vendus cobre todos os documentos da empresa nem se
  inclui recibos e pagamentos. Só um ficheiro real de uma conta de Angola permite
  confirmar (a validação XSD fica registada automaticamente).
- O endpoint só existe para a **Facturação**. SAF-T de Contabilidade e de Inventário
  não estão no Vendus. O estado desses ficheiros no LPS está em
  `docs/compliance/SAF-T.md` (Contabilidade não implementada; Inventário bloqueado por
  formato não publicado).

## SAF-T do LPS

O ficheiro exportado pelo LPS **exclui** os documentos `fiscal_engine = 'VENDUS'`
(V-SAFT2). Esses documentos são comunicados pelo Vendus, e a série interna VND nunca
aparece num SAF-T. Para uma empresa que mudou de motor a meio do mês, o SAF-T desse mês
são dois ficheiros: o do LPS (documentos LPS) e o do Vendus (documentos Vendus).
