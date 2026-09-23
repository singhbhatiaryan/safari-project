import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: /^@safari\/shared$/, replacement: fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url)) },
      { find: /^@shared\//, replacement: fileURLToPath(new URL('../../shared/src/', import.meta.url)) },
    ],
  },
  build: {
    ssr: 'scripts/smoke/tests.ts',
    outDir: '.tmp/smoke',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { entryFileNames: 'run.mjs', codeSplitting: false },
    },
  },
  ssr: {
    // jsdom stays a normal Node dependency (it is CJS and does not need bundling)
    external: ['jsdom'],
  },
});
