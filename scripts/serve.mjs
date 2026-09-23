#!/usr/bin/env node
/**
 * Zero-dependency static file server for the built start page.
 *
 *   npm run build:web
 *   npm run serve:web            # http://localhost:4173
 *   npm run serve:web -- 8080    # custom port
 *
 * Binds 0.0.0.0 so it also works behind a container/proxy.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../web/release', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function tryFile(path) {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return tryFile(join(path, 'index.html'));
    return path;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = await tryFile(join(root, safe));
  if (!file) file = await tryFile(join(root, 'index.html')); // SPA fallback
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`Not found. Did you run "npm run build:web"?\nLooked in ${root}`);
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(body);
}).listen(port, '0.0.0.0', () => {
  console.log(`Safari Start Page served from ${root}`);
  console.log(`  → http://localhost:${port}`);
});
