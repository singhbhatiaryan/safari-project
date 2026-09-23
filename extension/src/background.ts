/**
 * Service worker: the authoritative bookmark store.
 *
 *  • chrome.storage.local holds `safari.startpage.v1` — the same shape the website
 *    uses, merged with `mergeStates()` so both sides converge.
 *  • Every write is broadcast to start-page tabs (content script → CustomEvent) and
 *    to extension pages (runtime message), so an open page updates in ~50 ms.
 *  • Commands: ⌘⇧S opens the popup (handled by Chrome), ⌘⇧E saves instantly,
 *    ⌘⇧Space opens the start page.
 */
import {
  BRIDGE_MESSAGES,
  STORAGE_KEY,
  bestIconFor,
  collectPageIcons,
  createDefaultState,
  deleteItems,
  isProbablyNotBookmarkable,
  liveItems,
  makeBookmark,
  mergeStates,
  sanitize,
  type Item,
  type PageIconInfo,
  type StoreState,
} from '@safari/shared';

const PREFS_KEY = 'safari.prefs';
const NEWTAB_PAGE = 'newtab.html';

interface Prefs {
  openAfterSave?: boolean;
  defaultFolderId?: string | null;
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

async function readStore(): Promise<StoreState> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const value = raw?.[STORAGE_KEY];
  if (!value) {
    // Seed once and persist, so every later read (and the page's first handshake)
    // sees the same ids instead of a freshly generated set of defaults.
    const seeded = createDefaultState(true);
    await chrome.storage.local.set({ [STORAGE_KEY]: seeded });
    return seeded;
  }
  return sanitize(value);
}

async function writeStore(state: StoreState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function readPrefs(): Promise<Prefs> {
  const raw = await chrome.storage.local.get(PREFS_KEY);
  return (raw?.[PREFS_KEY] as Prefs) ?? {};
}

async function writePrefs(patch: Prefs): Promise<void> {
  const next = { ...(await readPrefs()), ...patch };
  await chrome.storage.local.set({ [PREFS_KEY]: next });
}

/* ------------------------------------------------------------------ */
/* serialised mutations (a service worker can be hit concurrently)      */
/* ------------------------------------------------------------------ */

let chain: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

/* ------------------------------------------------------------------ */
/* broadcasting                                                        */
/* ------------------------------------------------------------------ */

async function broadcast(state: StoreState): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: BRIDGE_MESSAGES.APPLY, state }, { frameId: 0 });
      } catch {
        // No content script in that tab (or it is a chrome:// page) — expected.
      }
    }),
  );
  try {
    // Reaches extension pages: the new-tab page and the popup.
    await chrome.runtime.sendMessage({ type: BRIDGE_MESSAGES.APPLY, state });
  } catch {
    // Nobody listening (no start page open) — also expected.
  }
}

/** Merges incoming state, persists and broadcasts only when something changed. */
async function ingest(incoming: StoreState): Promise<StoreState> {
  const local = await readStore();
  const merged = mergeStates(local, incoming);
  if (merged.changed) {
    await writeStore(merged.state);
    await broadcast(merged.state);
  }
  return merged.state;
}

/* ------------------------------------------------------------------ */
/* saving                                                             */
/* ------------------------------------------------------------------ */

interface SavePayload {
  title: string;
  url: string;
  favicon?: string | null;
  parentId?: string | null;
}

async function addBookmark(payload: SavePayload): Promise<{ item: Item; state: StoreState }> {
  const state = await readStore();
  const parentId = payload.parentId ?? null;
  const siblings = liveItems(state.items).filter((i) => i.parentId === parentId);
  const item = makeBookmark(
    {
      title: payload.title.trim() || payload.url,
      url: payload.url,
      favicon: bestIconFor(payload.url, payload.favicon ?? null) ?? undefined,
    },
    parentId,
    siblings.length,
  );
  const next: StoreState = { ...state, items: [...state.items, item], updatedAt: Date.now() };
  await writeStore(next);
  await broadcast(next);
  return { item, state: next };
}

async function removeItems(ids: string[]): Promise<StoreState> {
  const state = await readStore();
  const next = deleteItems(state, ids);
  await writeStore(next);
  await broadcast(next);
  return next;
}

/** Best available icon for a tab: page-declared touch icon → favicon service. */
async function discoverIcon(tabId: number | undefined, url: string): Promise<string | null> {
  if (tabId !== undefined) {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: collectPageIcons,
      });
      const info = injected?.[0]?.result as PageIconInfo | undefined;
      if (info?.icons?.length) return info.icons[0];
    } catch {
      // Not injectable (chrome://, the web store, a PDF viewer…) — fall through.
    }
  }
  return bestIconFor(url);
}

async function saveActiveTab(): Promise<{ ok: boolean; title?: string; reason?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || isProbablyNotBookmarkable(tab.url)) {
    return { ok: false, reason: 'This page cannot be bookmarked.' };
  }
  const prefs = await readPrefs();
  const favicon = await discoverIcon(tab.id, tab.url);
  const { item } = await addBookmark({
    title: tab.title ?? tab.url,
    url: tab.url,
    favicon,
    parentId: prefs.defaultFolderId ?? null,
  });
  await flashBadge('✓');
  return { ok: true, title: item.title };
}

async function flashBadge(text: string, colour = '#34C759'): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: colour });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
    }, 1800);
  } catch {
    /* action may be unavailable during teardown */
  }
}

function openStartPage(newTab = true): void {
  const url = chrome.runtime.getURL(NEWTAB_PAGE);
  if (newTab) void chrome.tabs.create({ url });
  else void chrome.tabs.update({ url });
}

/* ------------------------------------------------------------------ */
/* message routing                                                     */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message: any, _sender, respond) => {
  const type = message?.type;

  if (type === BRIDGE_MESSAGES.PING) {
    respond({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }

  if (type === BRIDGE_MESSAGES.HELLO) {
    void serial(async () => {
      const state = await readStore();
      respond({ state });
    });
    return true; // async response
  }

  if (type === BRIDGE_MESSAGES.PUSH && message.state) {
    void serial(async () => {
      const state = await ingest(sanitize(message.state));
      respond({ state });
    });
    return true;
  }

  if (type === 'SAFARI_SAVE_TAB') {
    void serial(async () => {
      const payload = message.payload as SavePayload;
      const { item } = await addBookmark(payload);
      respond({ ok: true, item });
    });
    return true;
  }

  if (type === 'SAFARI_DELETE_ITEMS') {
    void serial(async () => {
      const state = await removeItems(message.ids as string[]);
      respond({ ok: true, state });
    });
    return true;
  }

  if (type === 'SAFARI_SET_PREFS') {
    void serial(async () => {
      await writePrefs(message.prefs as Prefs);
      respond({ ok: true });
    });
    return true;
  }

  if (type === 'SAFARI_SAVE_ACTIVE_TAB') {
    void serial(async () => respond(await saveActiveTab()));
    return true;
  }

  if (type === 'SAFARI_OPEN_START_PAGE') {
    openStartPage(message.newTab !== false);
    respond({ ok: true });
    return false;
  }

  return false;
});

/* ------------------------------------------------------------------ */
/* commands + lifecycle                                                */
/* ------------------------------------------------------------------ */

chrome.commands.onCommand.addListener((command) => {
  if (command === 'instant_save') {
    void serial(async () => {
      const result = await saveActiveTab();
      if (!result.ok) await flashBadge('!', '#FF453A');
    });
    return;
  }
  if (command === 'open_start_page') {
    openStartPage(true);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  void serial(async () => {
    const existing = await chrome.storage.local.get(STORAGE_KEY);
    if (!existing?.[STORAGE_KEY]) await writeStore(createDefaultState(true));
    if (details.reason === 'install') {
      chrome.contextMenus.create(
        {
          id: 'safari-save-page',
          title: 'Save Page to Safari Start Page',
          contexts: ['page'],
        },
        () => void chrome.runtime.lastError,
      );
      chrome.contextMenus.create(
        {
          id: 'safari-save-link',
          title: 'Save Link to Safari Start Page',
          contexts: ['link'],
        },
        () => void chrome.runtime.lastError,
      );
    }
  });
});

chrome.contextMenus?.onClicked.addListener((info) => {
  const url = info.linkUrl ?? info.pageUrl;
  if (!url) return;
  void serial(async () => {
    const favicon = await discoverIcon(undefined, url);
    await addBookmark({ title: info.selectionText || url, url, favicon, parentId: null });
    await flashBadge('✓');
  });
});
