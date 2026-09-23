import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Three entries, one build:
 *   popup.html    → the Quick Save sheet
 *   newtab.html   → the start page (only reachable if the new-tab override is on)
 *   background.ts → the service worker, forced to a stable filename because
 *                   manifest.json references `background.js` by name.
 */
export default defineConfig({
  // Root is the extension folder so `/src/...` in the HTML entries resolves here.
  root: here('.'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@safari\/shared$/, replacement: here('../shared/src/index.ts') },
      { find: /^@shared\//, replacement: here('../shared/src/') },
      { find: /^@web\//, replacement: here('../web/src/') },
    ],
  },
  // public/ is copied verbatim into the build, which keeps manifest.json in one
  // predictable place for scripts/toggle-newtab.mjs and for a fresh clone.
  publicDir: 'public',
  base: './',
  build: {
    outDir: 'release',
    emptyOutDir: true,
    target: 'chrome110',
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: here('popup.html'),
        newtab: here('newtab.html'),
        background: here('src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
