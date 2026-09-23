/**
 * Conflict-free-ish merge for a local-first setup: last-write-wins per item with
 * tombstones, plus a deterministic tie-break so two browsers that edit at the
 * exact same millisecond still converge on the same result.
 */
import { Item, STORE_VERSION, StoreState, TOMBSTONE_TTL_MS } from './types';
import { mergeStats } from './store';

export interface MergeResult {
  state: StoreState;
  changed: boolean;
  /** true when the incoming state was not already a superset of ours */
  remoteStale: boolean;
}

function pickNewer(a: Item, b: Item): Item {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) return a;
  return sa > sb ? a : b; // deterministic tie-break → convergence
}

export function mergeStates(local: StoreState, remote: StoreState): MergeResult {
  const byId = new Map<string, Item>();
  for (const item of local.items) byId.set(item.id, item);
  for (const item of remote.items) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? pickNewer(item, existing) : item);
  }

  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const items = [...byId.values()]
    .filter((i) => !(i.deletedAt !== null && i.deletedAt < cutoff))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Visit stats are commutative (max), so they can never conflict and never lose a
  // count — including when the same page was opened in two browsers.
  const stats: StoreState['stats'] = {};
  for (const id of new Set([...Object.keys(local.stats ?? {}), ...Object.keys(remote.stats ?? {})])) {
    const merged = mergeStats(local.stats?.[id], remote.stats?.[id]);
    if (merged.c > 0 || merged.t > 0) stats[id] = merged;
  }

  // Settings are merged as a document; the newest editor wins. On an exact tie we
  // take the incoming document: the local side already has its own copy, so the
  // remote one is strictly new information. (Two edits in the same millisecond are
  // otherwise arbitrary, and the page's change would silently disappear.)
  const localNewer = local.settingsUpdatedAt > remote.settingsUpdatedAt;
  const settingsSource = localNewer ? local.settings : remote.settings;
  const wallpaperMap = new Map<string, StoreState['settings']['wallpapers'][number]>();
  for (const w of [...local.settings.wallpapers, ...remote.settings.wallpapers]) {
    if (!wallpaperMap.has(w.id)) wallpaperMap.set(w.id, w);
  }
  const settings = {
    ...settingsSource,
    wallpapers: [...wallpaperMap.values()].sort((a, b) => a.createdAt - b.createdAt),
  };

  const state: StoreState = {
    version: STORE_VERSION,
    items,
    stats,
    settings,
    settingsUpdatedAt: Math.max(local.settingsUpdatedAt, remote.settingsUpdatedAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };

  return {
    state,
    changed: fingerprint(state) !== fingerprint(local),
    remoteStale: fingerprint(remote) !== fingerprint(state),
  };
}

/**
 * Canonical, order-insensitive fingerprint.
 *
 * Display order lives in `Item.order`, so the order of the `items` array itself is
 * meaningless — comparing it would report "changed" for two identical stores and
 * trigger an extra sync round-trip on every handshake.
 */
export function fingerprint(state: StoreState): string {
  return JSON.stringify({
    i: [...state.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    s: state.settings,
    v: state.stats ?? {},
  });
}
