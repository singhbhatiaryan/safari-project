import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@safari\/shared$/, replacement: shared },
      { find: /^@shared\//, replacement: fileURLToPath(new URL('../shared/src/', import.meta.url)) },
    ],
  },
  base: './',
  build: {
    outDir: 'release',
    emptyOutDir: true,
    target: 'chrome110',
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The sandbox preview serves the dev server through a generated hostname.
    allowedHosts: true,
    cors: true,
    fs: { allow: ['..', '.'] },
    hmr: { clientPort: 443, protocol: 'wss' },
  },
  preview: { host: '0.0.0.0', allowedHosts: true, port: 4173 },
});
