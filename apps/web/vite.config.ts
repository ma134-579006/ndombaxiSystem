import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Painel de administração Ndombaxi System. VITE_API_URL define a API.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, host: true },
  preview: { port: 5175 },
});
