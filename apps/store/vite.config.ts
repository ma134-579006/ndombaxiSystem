import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Montra pública Ndombaxi System. VITE_API_URL define a API; VITE_STORE_CODE o código da loja.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    // DEV ONLY: proxy /papi → API de produção, reescrevendo a Origin para um
    // domínio permitido (contorna o CORS para testar no preview com dados reais).
    proxy: {
      '/papi': {
        target: 'https://ndombaxi-api.onrender.com',
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
});
