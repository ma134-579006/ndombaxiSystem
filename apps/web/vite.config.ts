import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Painel de administração Ndombaxi System. VITE_API_URL define a API.
// `design.html` = style guide vivo do Design System (estático, sem dados).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: true,
    // DEV ONLY (igual ao da loja): proxy /papi → API de produção, reescrevendo
    // a Origin para um domínio permitido — permite navegar o painel no preview
    // local com dados reais (auditoria/QA). Nunca afeta builds de produção.
    proxy: {
      '/papi': {
        target: 'https://ndombaxi-api-img.onrender.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/papi/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'https://ndombaxisystem.com');
          });
        },
      },
    },
  },
  preview: { port: 5175 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        design: resolve(__dirname, 'design.html'),
      },
    },
  },
});
