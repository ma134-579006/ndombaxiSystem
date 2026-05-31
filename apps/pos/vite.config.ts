import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Terminal de caixa NEXUS (web). VITE_API_URL define a API (default localhost:3000).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 5173 },
});
