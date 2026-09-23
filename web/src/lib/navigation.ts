/**
 * Pure helpers for keyboard navigation across the icon grid.
 *
 * The grid is a CSS grid of buttons, so navigation is index maths over a flat list
 * rather than a tree walk. Keeping it pure makes it testable and keeps StartPage
 * free of DOM spelunking.
 */

export interface GridGeometry {
  /** number of columns currently laid out */
  columns: number;
  /** number of tiles in the container */
  count: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Index the focus should move to, or null when the move would leave the grid
 * (the caller then decides: wrap, switch page, or ignore).
 */
export function nextIndex(from: number, direction: Direction, geometry: GridGeometry): number | null {
  const { columns, count } = geometry;
  if (count <= 0) return null;
  const current = Math.min(Math.max(from, 0), count - 1);
  const row = Math.floor(current / columns);
  const column = current % columns;
  const rows = Math.ceil(count / columns);

  switch (direction) {
    case 'left':
      return column === 0 ? null : current - 1;
    case 'right':
      return column === columns - 1 || current === count - 1 ? null : current + 1;
    case 'up':
      return row === 0 ? null : current - columns;
    case 'down':
      return row >= rows - 1 || current + columns >= count ? null : current + columns;
    default:
      return null;
  }
}

/** First tile of a page, for Home/End and for page switches. */
export function edgeIndex(edge: 'first' | 'last', geometry: GridGeometry): number {
  return edge === 'first' ? 0 : Math.max(0, geometry.count - 1);
}

export interface PageSlice {
  page: number;
  indexInPage: number;
}

export function locate(count: number, index: number, perPage: number): PageSlice {
  const safe = Math.min(Math.max(index, 0), Math.max(0, count - 1));
  return { page: Math.floor(safe / perPage), indexInPage: safe % perPage };
}

export function chunk<T>(list: T[], size: number): T[][] {
  if (size <= 0) return [list];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}

/**
 * Which tile should receive focus in a grid that is being re-rendered?
 * Used after a delete or a move so focus does not fall back to <body>.
 */
export function focusAfterRemoval(previousIndex: number, remaining: number): number {
  if (remaining <= 0) return -1;
  return Math.min(previousIndex, remaining - 1);
}

/** Reads the list of tiles inside a container in visual (DOM) order. */
export function tilesIn(container: Element | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>('.tile-hit'));
}

export function focusTile(container: Element | null, index: number): void {
  const tiles = tilesIn(container);
  if (!tiles.length) return;
  const target = tiles[Math.min(Math.max(index, 0), tiles.length - 1)];
  target?.focus();
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function focusedTileIndex(container: Element | null): number {
  const tiles = tilesIn(container);
  const active = document.activeElement as HTMLElement | null;
  if (!active) return -1;
  return tiles.findIndex((tile) => tile === active || tile.contains(active));
}

/** The grid the keyboard is currently inside (falls back to the first grid). */
export function activeGrid(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const fromActive = active?.closest<HTMLElement>('[data-grid]');
  if (fromActive) return fromActive;
  return document.querySelector<HTMLElement>('[data-grid]');
}

export function gridColumns(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const template = getComputedStyle(grid).gridTemplateColumns;
  return Math.max(1, template.split(' ').filter(Boolean).length);
}
