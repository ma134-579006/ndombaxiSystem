# Guia de preparação: registo e validação junto da AGT

Passos concretos, por ordem. Nenhum deles é feito automaticamente pelo sistema. Credenciais e chaves privadas nunca vão para o Git, para logs nem para o chat.

## 1. Produtor e software

1. No **Quiosque AGT**, com o NIF e a senha do Portal do Contribuinte do produtor: Serviços Gerais → Facturação Electrónica → **Torne-se parceiro**. Registar os representantes.
2. No **Super Admin → Fiscal (AGT)**, preencher o NIF e a designação legal do produtor (`producerTaxId`, `producerName`), o nome e a versão do produto.
3. No **Super Admin → Facturação Electrónica**:
   - **Gerar chave do software** (RSA 2048 ou 4096);
   - **Exportar** a chave pública.
4. No **Portal do Parceiro de HOMOLOGAÇÃO** (`portaldoparceiro.hml.minfin.gov.ao`), em "Solicitar registo de software": dados do software, dados do produtor e chave pública. No campo da chave escolher **PEM** e colar só o bloco `BEGIN PUBLIC KEY`.
5. Pedir as **credenciais Basic** por e-mail a produtores.dfe.dcrr.agt@minfin.gov.ao (nome e NIF da empresa).

## 2. Homologação

1. Super Admin → Facturação Electrónica:
   - ambiente **HML**;
   - utilizador e palavra-passe Basic;
   - nº de validação atribuído (`softwareValidationNumber`);
   - activar.
2. Numa empresa de teste com NIF real de testes:
   - carregar a chave privada do contribuinte emitida pela AGT;
   - estabelecimento "SEDE";
   - pedir as séries FT, FR e NC;
   - activar a empresa.
3. Emitir FT, FR, NC (anulação e devolução) e ND. Depois **Sincronizar** e confirmar o estado V em cada documento.
4. Confirmar com a AGT as contradições K1–K5 ([BLOQUEIOS-AGT.md](BLOQUEIOS-AGT.md)). Se as assinaturas forem recusadas (E08/E40), mudar o `typ` do JWS para JOSE.
5. Exportar o SAF-T do mês e correr `GET /pos/saft/validate`. Só entregar com `valid: true` e sem avisos de configuração.

## 3. Assinatura Modelo 8 (Hash do SAF-T)

1. Super Admin → Fiscal → **Gerar chave da plataforma** (1024) → exportar `public.txt`.
2. Entregar com a **Declaração Modelo 8** (nova versão da chave) **antes** de submeter novos SAF-T.
3. Em produção subscrita (ambiente PRODUCTION + "subscrito"), a emissão **recusa** documentos sem esta chave.

## 4. Produção

1. Registar a versão no **Portal do Parceiro de PRODUÇÃO**, com a mesma ou nova chave pública (`signatureVersion`).
2. Super Admin → ambiente **PROD**. Ao mudar, os pendentes de HML ficam SKIPPED. As empresas pedem séries de produção e reactivam.
3. Acompanhar o estado `communication` de cada empresa: com mais de 60 dias sem comunicação, a emissão bloqueia (art. 17.º).

## 5. Antes de declarar "pronto"

- Fechar T1–T3 de [BLOQUEIOS-AGT.md](BLOQUEIOS-AGT.md): recibos, contingência e postos locais.
- Repetir as baterias de [PLANO-E-RESULTADOS-TESTES.md](PLANO-E-RESULTADOS-TESTES.md) em homologação.
- Guardar a decisão escrita da AGT. Só ela permite usar "validado", "certificado" ou o nº de validação nos documentos.
