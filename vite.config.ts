import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
  test: { root: '.', include: ['server/test/**/*.test.ts'] },
} as never);
