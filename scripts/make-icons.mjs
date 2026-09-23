#!/usr/bin/env node
/**
 * Draws the extension / app icons as real PNGs — no image dependencies, no
 * binary blobs to hand-edit.
 *
 *   node scripts/make-icons.mjs
 *
 * Writes extension/public/icons/icon{16,48,128,256}.png (a blue squircle with the
 * Safari-ish compass mark) and web/public/favicon.png.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ------------------------------------------------------------------ */
/* minimal PNG encoder (truecolour + alpha)                            */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed-distance-ish coverage for a superellipse (Apple squircle), n = 5. */
function squircleCoverage(x, y, size, inset) {
  const r = size / 2 - inset;
  const dx = Math.abs(x - size / 2) / r;
  const dy = Math.abs(y - size / 2) / r;
  const value = Math.pow(dx, 5) + Math.pow(dy, 5);
  return clamp01((1 - value) * 14 + 0.5); // soft edge for antialiasing
}

function circleCoverage(x, y, cx, cy, radius, feather = 1.1) {
  const distance = Math.hypot(x - cx, y - cy);
  return clamp01((radius - distance) / feather + 0.5);
}

function ringCoverage(x, y, cx, cy, radius, thickness) {
  const distance = Math.hypot(x - cx, y - cy);
  return clamp01((thickness / 2 - Math.abs(distance - radius)) / 1.1 + 0.5);
}

/** Compass needle: two triangles meeting at the centre. */
function needleCoverage(x, y, size, angle, length, halfWidth) {
  const cx = size / 2;
  const cy = size / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  if (along < -length * 0.15 || along > length) return 0;
  const t = (along + length * 0.15) / (length * 1.15);
  const halfW = halfWidth * (1 - t);
  return clamp01((halfW - Math.abs(across)) * 2 + 0.5);
}

function over(dst, src, alpha) {
  const a = alpha === undefined ? 1 : alpha;
  return dst.map((v, i) => v * (1 - a) + src[i] * a);
}

/** Renders one icon into an RGBA buffer at 4× then averages down. */
function renderIcon(size, { padding = 0 } = {}) {
  const SS = 4;
  const big = size * SS;
  const out = Buffer.alloc(size * size * 4);

  const top = [0x2f, 0xb8, 0xff];
  const bottom = [0x0a, 0x6c, 0xff];
  const white = [255, 255, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x * SS + sx + 0.5) / SS;
          const py = (y * SS + sy + 0.5) / SS;
          const shape = squircleCoverage(px, py, size, padding);
          if (shape <= 0) continue;

          // gradient background
          let colour = mix(top, bottom, clamp01(py / size));
          // subtle glass highlight in the upper third
          colour = mix(colour, [255, 255, 255], 0.14 * clamp01(1 - py / (size * 0.62)));

          // compass ring
          const ring = ringCoverage(px, py, size / 2, size / 2, size * 0.3, size * 0.058);
          if (ring > 0) colour = over(colour, white, ring * 0.94);

          // needle (red north half, white south half)
          const north = needleCoverage(px, py, size, -Math.PI / 2 + 0.55, size * 0.28, size * 0.062);
          if (north > 0) colour = over(colour, [255, 90, 84], north);
          const south = needleCoverage(px, py, size, Math.PI / 2 + 0.55, size * 0.28, size * 0.062);
          if (south > 0) colour = over(colour, white, south);
          // centre hub
          const hub = circleCoverage(px, py, size / 2, size / 2, size * 0.035, 0.8);
          if (hub > 0) colour = over(colour, white, hub);

          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += shape;
        }
      }

      const samples = SS * SS;
      const alpha = a / samples;
      const offset = (y * size + x) * 4;
      if (alpha <= 0.001) {
        out[offset + 3] = 0;
        continue;
      }
      // premultiplied average → straight alpha
      out[offset] = Math.round(r / samples / alpha);
      out[offset + 1] = Math.round(g / samples / alpha);
      out[offset + 2] = Math.round(b / samples / alpha);
      out[offset + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

const targets = [
  [16, resolve(root, 'extension/public/icons/icon16.png')],
  [32, resolve(root, 'extension/public/icons/icon32.png')],
  [48, resolve(root, 'extension/public/icons/icon48.png')],
  [128, resolve(root, 'extension/public/icons/icon128.png')],
  [256, resolve(root, 'web/public/favicon.png')],
  [512, resolve(root, 'extension/public/icons/icon512.png')],
];

for (const [size, file] of targets) {
  mkdirSync(dirname(file), { recursive: true });
  const padding = size <= 32 ? size * 0.045 : size * 0.03;
  writeFileSync(file, encodePng(size, size, renderIcon(size, { padding })));
  console.log(`wrote ${file.replace(`${root}/`, '')} (${size}×${size})`);
}
