import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Painel de administração Ndombaxi System. VITE_API_URL define a API.
// `design.html` = style guide vivo do Design System (estático, sem dados).
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, host: true },
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
