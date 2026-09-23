#!/usr/bin/env node
/**
 * Turn the "replace Chrome's New Tab page with the Safari Start Page" override
 * on or off. It edits the *source* manifest (extension/public/manifest.json) and,
 * when a build exists, extension/release/manifest.json too.
 *
 *   npm run newtab on
 *   npm run newtab off
 *   npm run newtab status
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifests = [
  resolve(root, 'extension/public/manifest.json'),
  resolve(root, 'extension/release/manifest.json'),
];

const arg = (process.argv[2] || '').toLowerCase();
const NEWTAB = { newtab: 'newtab.html' };

if (!['on', 'off', 'status'].includes(arg)) {
  console.error('usage: node scripts/toggle-newtab.mjs <on|off|status>');
  process.exit(1);
}

let touched = 0;
for (const file of manifests) {
  if (!existsSync(file)) continue;
  const raw = await readFile(file, 'utf8');
  const json = JSON.parse(raw);
  const enabled = Boolean(json.chrome_url_overrides?.newtab);

  if (arg === 'status') {
    console.log(`${file}: ${enabled ? 'ON' : 'OFF'}`);
    continue;
  }
  if (arg === 'on') {
    if (enabled) continue;
    json.chrome_url_overrides = { ...(json.chrome_url_overrides || {}), ...NEWTAB };
  } else {
    if (!json.chrome_url_overrides) continue;
    delete json.chrome_url_overrides.newtab;
    if (!Object.keys(json.chrome_url_overrides).length) delete json.chrome_url_overrides;
  }
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
  touched++;
  console.log(`${arg === 'on' ? 'Enabled' : 'Disabled'} new-tab override in ${file.replace(root + '/', '')}`);
}

if (arg !== 'status' && touched === 0) {
  console.log('Nothing to change (already in the requested state, or no manifest found).');
}
if (arg !== 'status') {
  console.log('\nNext: reload the extension at chrome://extensions, or rebuild with `npm run build:ext`.');
}
