import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { kwanzaSeo } from './seo-kwanza';

// Montra pública LPS Vendas. VITE_API_URL define a API; VITE_STORE_CODE o código da loja.
export default defineConfig({
  plugins: [react(), kwanzaSeo()],
  server: {
    port: 5174,
    host: true,
    // DEV ONLY: proxy /papi → API de produção, reescrevendo a Origin para um
    // domínio permitido (contorna o CORS para testar no preview com dados reais).
    proxy: {
      '/papi': {
        target: process.env.PAPI_TARGET ?? 'https://ndombaxi-api-bwwr.onrender.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/papi/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'https://loja.ndombaxisystem.com');
          });
        },
      },
    },
  },
  preview: { port: 5174 },
  build: {
    // COMPATIBILIDADE com navegadores antigos (Safari 12–14 do iPhone/iPad,
    // WebViews Android antigas, Samsung Internet, Edge 79+): o esbuild converte o
    // JS moderno (?. ??) e o CSS moderno (ex.: `inset` → top/right/bottom/left)
    // para o que esses navegadores entendem. Sem isto, modais e ecrãs inteiros
    // desmontavam-se fora do Chrome recente.
    target: ['es2019', 'chrome64', 'edge79', 'firefox67', 'safari12'],
    cssTarget: ['chrome64', 'edge79', 'firefox67', 'safari12'],
  },
});
