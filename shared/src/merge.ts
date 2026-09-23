/**
 * Conflict-free-ish merge for a local-first setup: last-write-wins per item with
 * tombstones, plus a deterministic tie-break so two browsers that edit at the
 * exact same millisecond still converge on the same result.
 */
import { Item, STORE_VERSION, StoreState, TOMBSTONE_TTL_MS } from './types';

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

  // Settings are merged as a document; the newest editor wins. Custom wallpapers
  // are metadata only (bytes live in IndexedDB) so a union is always safe.
  const localNewer = local.settingsUpdatedAt >= remote.settingsUpdatedAt;
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

export function fingerprint(state: StoreState): string {
  return JSON.stringify({
    i: state.items,
    s: state.settings,
  });
}
