import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuração Capacitor das aplicações Android e iOS do Ndombaxi System.
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
  appName: 'Ndombaxi System',
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
  },
  android: {
    // Contexto seguro para a WebView (crypto.subtle).
    initialFocus: true,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
};

export default config;
