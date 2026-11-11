import type { CapacitorConfig } from '@capacitor/cli';

/**
 * LPS Loja — app Android da loja online (os clientes compram no telemóvel).
 *
 * `www` é a MESMA montra do site (apps/store) compilada com base relativa por
 * `scripts/prepare-web.mjs`. `androidScheme: 'https'` dá contexto seguro à WebView
 * (crypto.subtle, geolocalização para a entrega, câmara para ler QR de lojas).
 */
// LPS_APP=kwanza → app LPS Kwanza (marketplace de associados), mesmo shell, identidade própria.
const kwanza = process.env.LPS_APP === 'kwanza';
const config: CapacitorConfig = {
  appId: kwanza ? 'com.lpsvendas.kwanza' : 'com.lpsvendas.loja',
  appName: kwanza ? 'LPS Kwanza' : 'LPS Loja',
  webDir: 'www',
  server: { androidScheme: 'https' },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
  },
};

export default config;
