// web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy API calls to Express during development
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',  // rewrite cookie domain so browser stores it
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});