/**
 * Pure state transitions for the start page. Every function takes a StoreState
 * and returns a new one — no DOM, no storage, no React. Both the website and the
 * extension run exactly this code, which is what makes their data interchangeable.
 */
import {
  DOCK_ID,
  Item,
  READING_ID,
  Settings,
  STORE_VERSION,
  StoreState,
  VIRTUAL_PARENTS,
} from './types';

export function uid(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const now = () => Date.now();

export function createDefaultSettings(): Settings {
  return {
    layout: 'macos',
    theme: 'system',
    iconStyle: 'default',
    accent: '#0A84FF',
    wallpaper: 'grad:dawn',
    wallpapers: [],
    showFavorites: true,
    favoritesTitle: 'Favorites',
    showReadingList: true,
    showPrivacyReport: true,
    showSearch: true,
    searchEngine: 'google',
    showDock: true,
    labels: true,
    openInNewTab: true,
    dim: 18,
    blur: 28,
    columnsMac: 8,
    columnsIos: 4,
    rowsIos: 5,
    reduceMotion: false,
  };
}

export interface SeedBookmark {
  title: string;
  url: string;
  favicon?: string;
}

/**
 * Seed content uses *stable* ids on purpose. The website and the extension each
 * create their own defaults on first run; with random ids the first handshake
 * would merge two different-looking copies and the user would see every seed
 * twice. Stable ids make both sides describe the same items, so the merge
 * collapses them instead.
 */
const SEED_FOLDER_ID = 'seed-folder-reading';
const SEEDS: Array<SeedBookmark & { id: string }> = [
  { id: 'seed-apple', title: 'Apple', url: 'https://www.apple.com' },
  { id: 'seed-icloud', title: 'iCloud', url: 'https://www.icloud.com' },
  { id: 'seed-wikipedia', title: 'Wikipedia', url: 'https://wikipedia.org' },
  { id: 'seed-hackernews', title: 'Hacker News', url: 'https://news.ycombinator.com' },
  { id: 'seed-github', title: 'GitHub', url: 'https://github.com' },
  { id: 'seed-youtube', title: 'YouTube', url: 'https://youtube.com' },
];
const SEED_FOLDER_CHILDREN: Array<SeedBookmark & { id: string }> = [
  { id: 'seed-alistapart', title: 'A List Apart', url: 'https://alistapart.com' },
  { id: 'seed-mdn', title: 'MDN', url: 'https://developer.mozilla.org' },
];

export function createDefaultState(seed = true): StoreState {
  const t = now();
  const items: Item[] = [];
  if (seed) {
    SEEDS.forEach((bookmark, i) =>
      items.push({ ...makeBookmark(bookmark, null, i, t), id: bookmark.id }),
    );
    // A demo folder so the merge/ungroup behaviour is discoverable on day one.
    items.push({
      id: SEED_FOLDER_ID,
      type: 'folder',
      parentId: null,
      title: 'Reading',
      url: null,
      favicon: null,
      order: items.length,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    });
    SEED_FOLDER_CHILDREN.forEach((bookmark, i) =>
      items.push({ ...makeBookmark(bookmark, SEED_FOLDER_ID, i, t), id: bookmark.id }),
    );
  }
  return {
    version: STORE_VERSION,
    items,
    settings: createDefaultSettings(),
    settingsUpdatedAt: t,
    updatedAt: t,
  };
}

export function makeBookmark(
  seed: { title: string; url: string; favicon?: string },
  parentId: string | null,
  order: number,
  t = now(),
): Item {
  return {
    id: uid(),
    type: 'bookmark',
    parentId,
    title: seed.title,
    url: seed.url,
    favicon: seed.favicon ?? null,
    order,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
}

/* ------------------------------------------------------------------ */
/* reads                                                               */
/* ------------------------------------------------------------------ */

export const isLive = (i: Item): boolean => !i.deletedAt;
export const isVirtualParent = (id: string | null): boolean =>
  id !== null && VIRTUAL_PARENTS.includes(id);

export function liveItems(items: Item[]): Item[] {
  return items.filter(isLive);
}

export function itemById(items: Item[], id: string | null | undefined): Item | undefined {
  if (!id) return undefined;
  return items.find((i) => i.id === id && isLive(i));
}

/** Children of a container, in display order. */
export function childrenOf(items: Item[], parentId: string | null): Item[] {
  return liveItems(items)
    .filter((i) => i.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function withOrder(items: Item[], ids: string[], parentId: string | null): Item[] {
  const index = new Map(ids.map((id, i) => [id, i]));
  return items.map((i) =>
    i.parentId === parentId && index.has(i.id)
      ? { ...i, order: index.get(i.id)!, updatedAt: i.updatedAt }
      : i,
  );
}

/** Re-packs `order` to 0..n-1 per container. Cheap, and keeps drag maths simple. */
export function normalizeOrders(items: Item[]): Item[] {
  const buckets = new Map<string, Item[]>();
  for (const item of liveItems(items)) {
    const key = item.parentId ?? '__root__';
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const next = new Map<string, number>();
  for (const list of buckets.values()) {
    list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    list.forEach((item, i) => next.set(item.id, i));
  }
  return items.map((i) => (next.has(i.id) && next.get(i.id) !== i.order ? { ...i, order: next.get(i.id)! } : i));
}

export function collectDescendants(items: Item[], id: string, acc: string[] = []): string[] {
  for (const child of childrenOf(items, id)) {
    acc.push(child.id);
    if (child.type === 'folder') collectDescendants(items, child.id, acc);
  }
  return acc;
}

/** All folders, depth-first, with their depth — used by the extension's folder picker. */
export function folderTree(items: Item[], parentId: string | null = null, depth = 0): Array<{ item: Item; depth: number }> {
  const out: Array<{ item: Item; depth: number }> = [];
  for (const f of childrenOf(items, parentId).filter((i) => i.type === 'folder')) {
    out.push({ item: f, depth });
    out.push(...folderTree(items, f.id, depth + 1));
  }
  return out;
}

export function containsUrl(items: Item[], url: string, parentId: string | null): Item | undefined {
  return childrenOf(items, parentId).find((i) => i.url === url);
}

/* ------------------------------------------------------------------ */
/* writes                                                              */
/* ------------------------------------------------------------------ */

const touch = (state: StoreState, items: Item[], settingsTouched = false): StoreState => ({
  ...state,
  items,
  updatedAt: now(),
  settingsUpdatedAt: settingsTouched ? now() : state.settingsUpdatedAt,
});

export function addItem(
  state: StoreState,
  data: Partial<Item> & { type: Item['type']; title?: string; url?: string | null; parentId?: string | null },
): { state: StoreState; item: Item } {
  const t = now();
  const parentId = data.parentId ?? null;
  const siblings = childrenOf(state.items, parentId);
  const item: Item = {
    id: data.id ?? uid(),
    type: data.type,
    parentId,
    title: (data.title ?? (data.type === 'folder' ? 'New Folder' : 'Untitled')).trim() || 'Untitled',
    url: data.type === 'folder' ? null : (data.url ?? null),
    favicon: data.favicon ?? null,
    order: typeof data.order === 'number' ? data.order : siblings.length,
    createdAt: data.createdAt ?? t,
    updatedAt: t,
    deletedAt: null,
  };
  return { state: touch(state, normalizeOrders([...state.items, item])), item };
}

export function updateItem(state: StoreState, id: string, patch: Partial<Item>): StoreState {
  const t = now();
  return touch(
    state,
    state.items.map((i) => (i.id === id && isLive(i) ? { ...i, ...patch, id: i.id, updatedAt: t } : i)),
  );
}

/** Tombstones the ids plus everything nested inside folders. */
export function deleteItems(state: StoreState, ids: string[]): StoreState {
  const t = now();
  const doomed = new Set<string>();
  for (const id of ids) {
    const item = itemById(state.items, id);
    if (!item) continue;
    doomed.add(id);
    if (item.type === 'folder') collectDescendants(state.items, id).forEach((d) => doomed.add(d));
  }
  if (!doomed.size) return state;
  return touch(
    state,
    normalizeOrders(
      state.items.map((i) => (doomed.has(i.id) ? { ...i, deletedAt: t, updatedAt: t } : i)),
    ),
  );
}

/** Restores tombstones (used by undo of a delete). */
export function restoreItems(state: StoreState, ids: string[]): StoreState {
  const t = now();
  const back = new Set(ids);
  return touch(
    state,
    normalizeOrders(state.items.map((i) => (back.has(i.id) ? { ...i, deletedAt: null, updatedAt: t } : i))),
  );
}

/**
 * Moves items into `parentId` at `index`. Folders cannot be dropped inside
 * themselves or their own descendants.
 */
export function moveItems(
  state: StoreState,
  ids: string[],
  target: { parentId: string | null; index?: number },
): StoreState {
  const moving = ids
    .map((id) => itemById(state.items, id))
    .filter((i): i is Item => Boolean(i))
    .filter((i) => {
      if (i.parentId === target.parentId && target.parentId !== null) return true;
      if (i.id === target.parentId) return false;
      return !(i.type === 'folder' && target.parentId && collectDescendants(state.items, i.id).includes(target.parentId));
    });
  if (!moving.length) return state;

  const movingIds = new Set(moving.map((i) => i.id));
  const t = now();
  const parentId = target.parentId ?? null;

  // Everything that is already inside the destination keeps its relative order.
  const destination = childrenOf(state.items, parentId).filter((i) => !movingIds.has(i.id));
  const insertAt = target.index === undefined ? destination.length : Math.max(0, Math.min(target.index, destination.length));

  const next: Item[] = [];
  const stamped = new Map(
    moving.map((i) => [i.id, { ...i, parentId, updatedAt: t }] as const),
  );
  destination.forEach((item, i) => {
    if (i === insertAt) moving.forEach((m) => next.push(stamped.get(m.id)!));
    next.push(item);
  });
  if (insertAt >= destination.length) moving.forEach((m) => next.push(stamped.get(m.id)!));

  const others = state.items.filter((i) => !next.some((n) => n.id === i.id));
  const reordered = [...others, ...next.map((item, i) => ({ ...item, order: i }))];
  return touch(state, normalizeOrders(reordered));
}

/** Sets the exact order of one container (drag-reorder inside a grid/page). */
export function reorderContainer(state: StoreState, parentId: string | null, orderedIds: string[]): StoreState {
  const t = now();
  const index = new Map(orderedIds.map((id, i) => [id, i]));
  return touch(
    state,
    normalizeOrders(
      state.items.map((i) =>
        i.parentId === parentId && index.has(i.id) ? { ...i, order: index.get(i.id)!, updatedAt: t } : i,
      ),
    ),
  );
}

export function createFolder(
  state: StoreState,
  opts: { title?: string; parentId?: string | null; index?: number; childIds?: string[] } = {},
): { state: StoreState; folder: Item } {
  const parentId = opts.parentId ?? null;
  const siblings = childrenOf(state.items, parentId);
  const t = now();
  const folder: Item = {
    id: uid(),
    type: 'folder',
    parentId,
    title: opts.title ?? 'New Folder',
    url: null,
    favicon: null,
    order: opts.index ?? siblings.length,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  let next: StoreState = touch(state, normalizeOrders([...state.items, folder]));
  if (opts.childIds?.length) {
    next = moveItems(next, opts.childIds, { parentId: folder.id, index: 0 });
  }
  return { state: next, folder };
}

/**
 * The iOS/macOS "drop an icon onto another icon" gesture.
 *
 *  • onto a bookmark → a new folder is created where the target sat, containing
 *    the target followed by the dropped items
 *  • onto a folder   → the dropped items are appended inside it
 *
 * Returns the folder id so the UI can animate it open.
 */
export function mergeIntoFolder(
  state: StoreState,
  sourceIds: string[],
  targetId: string,
): { state: StoreState; folderId: string | null } {
  const target = itemById(state.items, targetId);
  const sources = sourceIds.map((id) => itemById(state.items, id)).filter((i): i is Item => Boolean(i));
  if (!target || !sources.length) return { state, folderId: null };
  if (sources.some((s) => s.id === targetId)) return { state, folderId: null };
  if (sources.some((s) => s.type === 'folder' && collectDescendants(state.items, s.id).includes(targetId))) {
    return { state, folderId: null };
  }

  if (target.type === 'folder') {
    return { state: moveItems(state, sources.map((s) => s.id), { parentId: target.id }), folderId: target.id };
  }

  const created = createFolder(state, { parentId: target.parentId, index: target.order, title: 'New Folder' });
  const withChildren = moveItems(created.state, [target.id, ...sources.map((s) => s.id)], {
    parentId: created.folder.id,
    index: 0,
  });
  return { state: withChildren, folderId: created.folder.id };
}

/** Splits a folder: its contents move up to where the folder was. */
export function ungroupFolder(state: StoreState, folderId: string): StoreState {
  const folder = itemById(state.items, folderId);
  if (!folder || folder.type !== 'folder') return state;
  const kids = childrenOf(state.items, folderId).map((k) => k.id);
  const moved = moveItems(state, kids, { parentId: folder.parentId, index: folder.order });
  return deleteItems(moved, [folderId]);
}

export function setSettings(state: StoreState, patch: Partial<Settings>): StoreState {
  return { ...state, settings: { ...state.settings, ...patch }, settingsUpdatedAt: now(), updatedAt: now() };
}

export function addCustomWallpaper(
  state: StoreState,
  meta: { id: string; name: string; mime: string; width: number; height: number },
): StoreState {
  const wallpaper: CustomWallpaperMeta = { ...meta, createdAt: now() };
  const wallpapers = [...state.settings.wallpapers.filter((w) => w.id !== meta.id), wallpaper];
  return setSettings(state, { wallpapers, wallpaper: `custom:${meta.id}` });
}

type CustomWallpaperMeta = Settings['wallpapers'][number];

export function removeCustomWallpaper(state: StoreState, id: string): StoreState {
  const wallpapers = state.settings.wallpapers.filter((w) => w.id !== id);
  const wallpaper = state.settings.wallpaper === `custom:${id}` ? 'grad:dawn' : state.settings.wallpaper;
  return setSettings(state, { wallpapers, wallpaper });
}

/* ------------------------------------------------------------------ */
/* migration + integrity                                               */
/* ------------------------------------------------------------------ */

/** Fills in missing fields, drops orphans, normalises orders. Never throws. */
export function sanitize(input: unknown): StoreState {
  const base = createDefaultState(false);
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<StoreState>;
  const items: Item[] = Array.isArray(raw.items)
    ? raw.items
        .filter((i): i is Item => Boolean(i && typeof i === 'object' && typeof (i as Item).id === 'string'))
        .map((i) => ({
          id: i.id,
          type: i.type === 'folder' ? 'folder' : 'bookmark',
          parentId: typeof i.parentId === 'string' ? i.parentId : null,
          title: typeof i.title === 'string' ? i.title : 'Untitled',
          url: typeof i.url === 'string' ? i.url : null,
          favicon: typeof i.favicon === 'string' ? i.favicon : null,
          order: typeof i.order === 'number' ? i.order : 0,
          createdAt: typeof i.createdAt === 'number' ? i.createdAt : now(),
          updatedAt: typeof i.updatedAt === 'number' ? i.updatedAt : now(),
          deletedAt: typeof i.deletedAt === 'number' ? i.deletedAt : null,
        }))
    : [];
  const ids = new Set(items.map((i) => i.id));
  const healed = items.map((i) => {
    if (!i.parentId) return i;
    const dangling = !isVirtualParent(i.parentId) && !ids.has(i.parentId);
    if (i.parentId === i.id || dangling) return { ...i, parentId: null };
    return i;
  });
  return {
    version: STORE_VERSION,
    items: normalizeOrders(healed),
    settings: { ...base.settings, ...(raw.settings || {}) },
    settingsUpdatedAt: typeof raw.settingsUpdatedAt === 'number' ? raw.settingsUpdatedAt : now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now(),
  };
}

/** Stable, order-insensitive fingerprint used to detect "nothing actually changed". */
export function signature(state: StoreState): string {
  return JSON.stringify(annotate(state));
}

function annotate(state: StoreState): unknown {
  return {
    i: [...state.items].sort((a, b) => (a.id < b.id ? -1 : 1)),
    s: state.settings,
  };
}

export const READING = READING_ID;
export const DOCK = DOCK_ID;
