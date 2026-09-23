/**
 * Apple's icons are not rounded rectangles — they are superellipses ("squircles").
 * CSS border-radius can only approximate that, so we generate the real path and
 * hand it to clip-path. Sampling a superellipse gives sub-pixel accuracy at tile
 * sizes and keeps the geometry identical at every zoom level.
 */

const cache = new Map<string, string>();

function superellipsePath(size: number, exponent: number, samples: number): string {
  const r = size / 2;
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const x = r + r * Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
    const y = r + r * Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `path('M${points.join('L')}Z')`;
}

/** n ≈ 5 matches the iOS/macOS app icon silhouette closely. */
export function squircle(size: number, exponent = 5): string {
  const key = `${size}:${exponent}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const path = superellipsePath(size, exponent, 72);
  cache.set(key, path);
  return path;
}

/** Folder windows and sheets use a gentler curve. */
export function roundedSquircle(size: number): string {
  return squircle(size, 4.2);
}
