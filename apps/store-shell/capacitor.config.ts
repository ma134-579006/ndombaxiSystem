import type { CapacitorConfig } from '@capacitor/cli';

/**
 * LPS Loja — app Android da loja online (os clientes compram no telemóvel).
 *
 * `www` é a MESMA montra do site (apps/store) compilada com base relativa por
 * `scripts/prepare-web.mjs`. `androidScheme: 'https'` dá contexto seguro à WebView
 * (crypto.subtle, geolocalização para a entrega, câmara para ler QR de lojas).
 */
const config: CapacitorConfig = {
  appId: 'com.lpsvendas.loja',
  appName: 'LPS Loja',
  webDir: 'www',
  server: { androidScheme: 'https' },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
  },
};

export default config;
