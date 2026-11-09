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
    // PAPI_TARGET (env) permite apontar a uma API local (validar alterações
    // da API antes de publicar) — sem env, mantém a produção.
    proxy: {
      '/papi': {
        target: process.env.PAPI_TARGET || 'https://ndombaxi-api-bwwr.onrender.com',
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
  build: {
    // COMPATIBILIDADE com navegadores antigos (Safari 12–14 do iPhone/iPad,
    // WebViews Android antigas, Samsung Internet, Edge 79+): o esbuild converte o
    // JS moderno (?. ??) e o CSS moderno (ex.: `inset` → top/right/bottom/left)
    // para o que esses navegadores entendem. Sem isto, modais e ecrãs inteiros
    // desmontavam-se fora do Chrome recente.
    target: ['es2019', 'chrome64', 'edge79', 'firefox67', 'safari12'],
    cssTarget: ['chrome64', 'edge79', 'firefox67', 'safari12'],
    // Build mais leve no Cloudflare Pages (sem tamanhos gzip no relatório).
    reportCompressedSize: false,
  },
});
