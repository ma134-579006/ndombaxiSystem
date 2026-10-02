import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuração Capacitor das aplicações Android e iOS do LPS Vendas.
 *
 * `webDir` é a pasta `www`, preparada pelo `scripts/prepare-web.mjs` — os mesmos
 * frontends do site (Gestão e Caixa) compilados com base relativa. É por isto
 * que a app móvel é idêntica ao site: não há UI recriada, é a mesma embrulhada.
 *
 * `androidScheme: 'https'` é o que dá à WebView um CONTEXTO SEGURO — sem ele não
 * há `crypto.subtle`, e sem `crypto.subtle` não há cifra em repouso nem
 * verificação do PIN offline (exatamente como no desktop, onde usamos um
 * protocolo `secure: true`).
 */
const config: CapacitorConfig = {
  appId: 'com.ndombaxi.system',
  appName: 'LPS Vendas',
  webDir: 'www',
  // Sobre a durabilidade: o plugin de SQLite grava num ficheiro nativo, fora da
  // WebView, por isso os dados sobrevivem à limpeza de cache do navegador do SO.
  plugins: {
    CapacitorSQLite: {
      // A base de dados vai para o armazenamento privado da app (Keychain no
      // iOS para a cifra da BD; ficheiro protegido no sandbox no Android).
      iosDatabaseLocation: 'Library/NdombaxiDatabases',
      iosIsEncryption: true,
      androidIsEncryption: true,
    },
    // Google Sign-In NATIVO (o Google bloqueia o OAuth em WebViews). O
    // `serverClientId` é o cliente WEB (522636462932-m67fvuutei…) — é a audiência
    // que a API verifica, por isso o token nativo é aceite sem mudar o backend. O
    // cliente ANDROID (522636462932-tc0tpn8k…, pacote com.ndombaxi.system + SHA-1)
    // é o que autoriza a app no Google Cloud; o Google associa-o pelo pacote/SHA-1.
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com',
      forceCodeForRefreshToken: false,
    },
  },
  android: {
    // Contexto seguro para a WebView (crypto.subtle).
    initialFocus: true,
    // O SERVIDOR DA LOJA (posto Windows na rede local) responde em http://IP:porta.
    // A WebView é servida de https://localhost; sem isto o pedido era bloqueado
    // como conteúdo misto e o telemóvel nunca chegava ao servidor local.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    // Android 9+ recusa HTTP em claro por omissão — necessário para o servidor da loja na LAN.
    cleartext: true,
    iosScheme: 'https',
  },
};

export default config;
