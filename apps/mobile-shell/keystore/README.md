# Chave de depuração fixa

`debug.keystore` é a chave de **depuração** usada pelo workflow `android-build.yml`
para que todos os APK de teste tenham a MESMA assinatura. Sem ela, cada compilação
na nuvem gerava uma chave nova e o Android recusava atualizar uma instalação
anterior ("App não instalada").

- Palavra-passe e alias são os padrão do Android (`android` / `androiddebugkey`) — não é segredo.
- SHA-1: `1E:62:E4:5D:BF:2A:25:4E:8F:C5:08:72:D8:A8:E4:CE:B6:9D:AA:EE`
  (registar no cliente Android do Google Cloud para o login Google funcionar no APK).
- **Não serve para a Play Store.** A publicação exige uma chave de produção própria,
  guardada fora do repositório (secrets do GitHub).

## Chave de produção (opcional, via secrets do GitHub)

Os três workflows Android usam `scripts/android-apk.sh`. Se existirem os secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (e,
opcionalmente, `ANDROID_KEY_PASSWORD`), o APK é compilado em release e assinado com
essa chave; sem eles, continua a ser o APK de depuração com a chave acima.

**Antes de definir os secrets:** um APK com outra assinatura não atualiza por cima
do instalado → cada aparelho tem de desinstalar e reinstalar (vendas offline ainda
não sincronizadas perdem-se) e o SHA-1 da nova chave tem de ser registado no Google
Cloud para o login Google continuar a funcionar.
