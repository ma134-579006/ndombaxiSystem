import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Terminal de caixa NEXUS (web). VITE_API_URL define a API (default localhost:3000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // DEV ONLY (igual ao web/loja): proxy /papi → API de produção com Origin
    // permitida — auditoria/QA no preview local com dados reais.
    proxy: {
      '/papi': {
        target: 'https://ndombaxi-api-img.onrender.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/papi/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'https://caixa.ndombaxisystem.com');
          });
        },
      },
    },
  },
  preview: { port: 5173 },
});
