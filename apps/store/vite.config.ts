import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Montra pública Ndombaxi System. VITE_API_URL define a API; VITE_STORE_CODE o código da loja.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, host: true },
  preview: { port: 5174 },
});
