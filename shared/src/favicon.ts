/**
 * Favicon resolution, shared by the site, the popup and the service worker.
 * Everything degrades: real Apple touch icon → favicon service → letter tile.
 */
import { Item } from './types';

const FAVICON_SERVICE = 'https://www.google.com/s2/favicons';

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Ordered list of icon urls to try for a page, best quality first. */
export function iconCandidates(url: string | null | undefined, extra: string[] = []): string[] {
  const list: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && !list.includes(v)) list.push(v);
  };
  extra.forEach(push);
  try {
    const origin = new URL(url as string).origin;
    push(`${origin}/apple-touch-icon.png`);
    push(`${origin}/apple-touch-icon-precomposed.png`);
  } catch {
    /* not a url */
  }
  const host = hostnameOf(url);
  if (host) push(`${FAVICON_SERVICE}?domain=${encodeURIComponent(host)}&sz=128`);
  return list;
}

/** The single url we persist for an item. */
export function bestIconFor(url: string | null | undefined, discovered?: string | null): string | null {
  if (discovered) return discovered;
  const host = hostnameOf(url);
  if (!host) return null;
  return `${FAVICON_SERVICE}?domain=${encodeURIComponent(host)}&sz=128`;
}

export function itemIcon(item: Pick<Item, 'url' | 'favicon' | 'title'>): string {
  return item.favicon || bestIconFor(item.url) || letterAvatar(item.title);
}

export function initialOf(title: string): string {
  const clean = (title || '').trim();
  if (!clean) return '•';
  const first = clean[0];
  if (/[\p{L}\p{N}]/u.test(first)) return first.toUpperCase();
  const alnum = clean.match(/[\p{L}\p{N}]/u);
  return alnum ? alnum[0].toUpperCase() : '•';
}

/** Deterministic pastel from a string — used for letter tiles. */
export function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${hash} 62% 52%)`;
}

/** Offline-safe squircle tile with the page's initial. */
export function letterAvatar(title: string, color = tintFor(title || 'x')): string {
  const letter = initialOf(title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.95"/><stop offset="1" stop-color="${color}" stop-opacity="0.72"/></linearGradient></defs><rect width="128" height="128" rx="29" fill="url(#g)"/><text x="64" y="64" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Display',Helvetica,Arial,sans-serif" font-size="64" font-weight="600" fill="#fff" text-anchor="middle" dominant-baseline="central">${letter.replace(/[<>&]/g, '')}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface PageIconInfo {
  icons: string[];
  title: string;
  description: string;
}

/**
 * Runs *inside the inspected page* via chrome.scripting.executeScript.
 * Must stay dependency-free and self-contained — it is serialised, not bundled.
 */
export function collectPageIcons(): PageIconInfo {
  const toAbsolute = (href: string | null): string | null => {
    if (!href) return null;
    try {
      return new URL(href, document.baseURI).href;
    } catch {
      return null;
    }
  };

  const scored: Array<{ href: string; size: number }> = [];
  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel]'))) {
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    if (!rel.includes('icon')) continue;
    const href = toAbsolute(link.getAttribute('href'));
    if (!href || href.startsWith('data:')) continue;
    const sizes = link.getAttribute('sizes') || '';
    const match = sizes.match(/(\d+)\s*x\s*(\d+)/i);
    let size = match ? Number(match[1]) : 0;
    if (rel.includes('apple-touch-icon')) size = Math.max(size, 180);
    if (href.endsWith('.svg')) size += 40;
    scored.push({ href, size });
  }
  scored.sort((a, b) => b.size - a.size);

  const icons = scored.slice(0, 4).map((s) => s.href);
  const ogImage =
    document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ||
    document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content ||
    '';
  const ogAbsolute = toAbsolute(ogImage);
  if (ogAbsolute && icons.length === 0) icons.push(ogAbsolute);

  const description =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ||
    '';

  return { icons, title: document.title || '', description: description.slice(0, 300) };
}

/** Browser-internal pages can't be bookmarked meaningfully; the popup says so. */
export function isProbablyNotBookmarkable(url: string | undefined | null): boolean {
  if (!url) return true;
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/i.test(url);
}

export function safeHostLabel(url: string | null | undefined): string {
  return hostnameOf(url) ?? '';
}
