/**
 * Shared data model for the Safari Start Page.
 *
 * IMPORTANT: the extension's background service worker and content-script bridge
 * are shipped as plain (un-bundled) JS and therefore repeat the few literals they
 * need (STORAGE_KEY / message names). Keep those in sync with this file.
 */

export type ItemType = 'bookmark' | 'folder';
export type LayoutMode = 'macos' | 'ios';
export type ThemeMode = 'light' | 'dark' | 'system';
export type IconStyle = 'default' | 'dark' | 'tinted';
export type SearchEngineId = 'google' | 'duckduckgo' | 'bing' | 'brave' | 'wikipedia' | 'none';

/** localStorage / chrome.storage key holding the whole start page. */
export const STORAGE_KEY = 'safari.startpage.v1';
/** Channel used to sync open tabs of the site instantly. */
export const SYNC_CHANNEL = 'safari.startpage.sync';
export const STORE_VERSION = 1;

/** Virtual containers. They are real `parentId` values, which keeps every
 *  merge / reorder algorithm working unchanged for dock + reading list items. */
export const DOCK_ID = '__dock__';
export const READING_ID = '__reading__';
export const VIRTUAL_PARENTS: readonly string[] = [DOCK_ID, READING_ID];

/** Tombstones are kept this long so deletes propagate across devices/tabs. */
export const TOMBSTONE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface Item {
  id: string;
  type: ItemType;
  /** null = top level of the Favorites grid, or one of the VIRTUAL_PARENTS. */
  parentId: string | null;
  title: string;
  /** absolute http(s) url — null for folders */
  url: string | null;
  /** resolved icon, usually a high-res apple-touch-icon or favicon service url */
  favicon: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** set when deleted; the record lingers until TOMBSTONE_TTL_MS has passed */
  deletedAt: number | null;
}

/**
 * Visit statistics used by the "Frequently Visited" section.
 *
 * Kept outside `Item` on purpose: clicks change constantly, and stamping
 * `updatedAt` on every open would make a click win a merge against a real edit.
 * Stats merge as max(clicks) / max(timestamp) instead, so they cannot conflict.
 */
export interface ItemStats {
  /** number of times opened from the start page */
  c: number;
  /** last time it was opened */
  t: number;
}

export interface CustomWallpaper {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface Settings {
  layout: LayoutMode;
  /** when the first-run tips were dismissed (null = never shown) */
  tipsDismissedAt: number | null;
  theme: ThemeMode;
  iconStyle: IconStyle;
  accent: string;
  /** 'grad:<id>' | 'img:<id>' | 'custom:<id>' */
  wallpaper: string;
  wallpapers: CustomWallpaper[];
  showFavorites: boolean;
  favoritesTitle: string;
  showFrequentlyVisited: boolean;
  frequentTitle: string;
  showReadingList: boolean;
  showPrivacyReport: boolean;
  showSearch: boolean;
  searchEngine: SearchEngineId;
  showDock: boolean;
  labels: boolean;
  openInNewTab: boolean;
  /** 0–80, darkens the wallpaper so icons stay legible */
  dim: number;
  /** 0–40, blur radius for the glass surfaces */
  blur: number;
  /** vignette + fine film grain over the wallpaper */
  ambient: boolean;
  /** slow drift animation on gradient wallpapers */
  wallpaperMotion: boolean;
  columnsMac: number;
  columnsIos: number;
  rowsIos: number;
  reduceMotion: boolean;
}

export interface StoreState {
  version: number;
  items: Item[];
  /** itemId → visit stats (see ItemStats) */
  stats: Record<string, ItemStats>;
  settings: Settings;
  settingsUpdatedAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Bridge protocol (page ⇄ content script ⇄ service worker)            */
/* ------------------------------------------------------------------ */

export const BRIDGE_EVENTS = {
  /** page → content script: "the user changed something here" */
  LOCAL_CHANGE: 'safari:store-local-change',
  /** content script → page: "here is the merged store, apply it" */
  EXTERNAL_CHANGE: 'safari:store-external',
  /** page → content script: "please re-sync now" */
  SYNC_REQUEST: 'safari:sync-request',
  /** content script → page: handshake so the UI can show 'connected' */
  BRIDGE_READY: 'safari:bridge-ready',
} as const;

export const BRIDGE_MESSAGES = {
  HELLO: 'SAFARI_BRIDGE_HELLO',
  PUSH: 'SAFARI_STORE_PUSH',
  APPLY: 'SAFARI_STORE_APPLY',
  SAVE_TAB: 'SAFARI_SAVE_TAB',
  PING: 'SAFARI_PING',
} as const;

/** Marker the web app advertises so the content script knows it is on the start page. */
export const SITE_MARKER = 'safari-startpage';
export const BRIDGE_VERSION = 1;
