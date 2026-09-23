/** Small library helpers shared by the components (kept separate from React hooks). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Item, itemIcon, iconCandidates, letterAvatar, wallpaperObjectUrl } from '@safari/shared';

/* ------------------------------------------------------------------ */
/* favicon with graceful fallback chain                                */
/* ------------------------------------------------------------------ */

export function useFaviconSrc(item: Pick<Item, 'url' | 'favicon' | 'title'>): {
  src: string;
  onError: () => void;
} {
  const candidates = useMemo(() => {
    const list = [item.favicon, ...iconCandidates(item.url)].filter((v): v is string => Boolean(v));
    return [...new Set(list)];
  }, [item.favicon, item.url]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidates]);

  const onError = useCallback(() => setIndex((i) => i + 1), []);
  const src = candidates[index] ?? letterAvatar(item.title);
  return { src, onError };
}

/* ------------------------------------------------------------------ */
/* custom wallpaper object urls                                        */
/* ------------------------------------------------------------------ */

export function useWallpaperUrls(ids: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = ids.join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const id of ids) {
        const url = await wallpaperObjectUrl(id);
        if (url) next[id] = url;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

/* ------------------------------------------------------------------ */
/* misc                                                               */
/* ------------------------------------------------------------------ */

export function hostLabel(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function prettyPath(item: Item): string | null {
  if (!item.url) return null;
  try {
    const url = new URL(item.url);
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
    return path === '' ? null : path.length > 42 ? `${path.slice(0, 40)}…` : path;
  } catch {
    return null;
  }
}

/** Click-and-hold detection for touch devices (iOS-style long press). */
export function useLongPress(onLongPress: () => void, ms = 480): {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerMove: (e: React.PointerEvent) => void;
} {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      origin.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(() => onLongPress(), ms);
    },
    onPointerMove: (e) => {
      if (!origin.current) return;
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
  };
}

/** Measures a grid's column count so we can chunk iOS pages correctly. */
export function useGridMetrics() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      const count = style.gridTemplateColumns.split(' ').filter(Boolean).length;
      setColumns(Math.max(1, count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, columns };
}

export function openUrl(url: string | null, newTab: boolean): void {
  if (!url) return;
  if (newTab) window.open(url, '_blank', 'noopener,noreferrer');
  else window.location.href = url;
}

export function download(filename: string, content: string, type = 'application/json'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Icon src for a tile, with the full fallback chain baked in. */
export function tileIconSrc(item: Pick<Item, 'url' | 'favicon' | 'title'>): string {
  return itemIcon(item);
}
