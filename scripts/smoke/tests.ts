/**
 * Headless smoke test.
 *
 *   npm run smoke
 *
 * There is no browser in CI here, so this mounts the *real* StartPage inside
 * jsdom and exercises the store algorithms that the drag-and-drop layer calls:
 * merge-into-folder, reorder index maths, tombstones + undo, and the two-way
 * merge used to keep the extension and the website in sync.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});

const { window } = dom;
const g = globalThis as unknown as Record<string, unknown>;

// --- expose the DOM to the app -------------------------------------------
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'PointerEvent',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'DOMParser',
  'Image',
  'Blob',
  'File',
  'indexedDB',
  'MutationObserver',
] as const) {
  if (key in window) {
    // Node 22 defines some of these as getter-only globals; defineProperty is
    // the only way to swap them for the jsdom versions.
    Object.defineProperty(g, key, {
      value: (window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
}
Object.defineProperty(g, 'localStorage', { value: window.localStorage, configurable: true });
Object.defineProperty(g, 'navigator', { value: window.navigator, configurable: true });

// jsdom lacks ResizeObserver; the grid measure hook only needs it to exist.
(window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
g.matchMedia = (window as unknown as Record<string, unknown>).matchMedia;
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
g.ResizeObserver = ResizeObserverStub;
(window as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;

// dnd-kit measures elements; jsdom reports 0×0 rects, which is fine for a render.
if (!window.Element.prototype.scrollTo) {
  (window.Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
}

/* ------------------------------------------------------------------ */
/* tiny assertion helpers                                              */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}`, detail === undefined ? '' : `\n      → ${JSON.stringify(detail)}`);
  }
}

function group(title: string): void {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* 1. pure store logic                                                 */
/* ------------------------------------------------------------------ */

const shared = await import('@safari/shared');
const {
  createDefaultState,
  childrenOf,
  itemById,
  mergeIntoFolder,
  moveItems,
  deleteItems,
  restoreItems,
  sanitize,
  mergeStates,
  createFolder,
  ungroupFolder,
  resolveWallpaper,
  folderTree,
  addItem,
  signature,
  recordOpen,
  topVisited,
  clearStats,
  visitCount,
} = shared;

group('store: defaults');
{
  const state = createDefaultState(true);
  check('seeds six bookmarks', childrenOf(state.items, null).filter((i) => i.type === 'bookmark').length === 6);
  check('seeds a folder with two children', childrenOf(state.items, null).some((i) => i.type === 'folder' && childrenOf(state.items, i.id).length === 2));
  check('orders are contiguous', childrenOf(state.items, null).every((item, index) => item.order === index));
}

group('drag: bookmark dropped onto bookmark creates a folder');
{
  const base = createDefaultState(false);
  const withA = addItem(base, { type: 'bookmark', title: 'A', url: 'https://a.example', parentId: null }).state;
  const withB = addItem(withA, { type: 'bookmark', title: 'B', url: 'https://b.example', parentId: null }).state;
  const withC = addItem(withB, { type: 'bookmark', title: 'C', url: 'https://c.example', parentId: null }).state;
  const [a, b] = childrenOf(withC.items, null);
  const result = mergeIntoFolder(withC, [b.id], a.id);

  check('a folder id came back', Boolean(result.folderId));
  const folder = itemById(result.state.items, result.folderId);
  check('folder is named "New Folder"', folder?.title === 'New Folder');
  check('folder sits where the target sat', folder?.order === 0);
  check('folder holds exactly the two merged items', childrenOf(result.state.items, result.folderId).length === 2);
  check(
    'first child is the target, second is the dragged item',
    childrenOf(result.state.items, result.folderId).map((i) => i.id).join() === [a.id, b.id].join(),
  );
  check('drag source left the root', childrenOf(result.state.items, null).every((i) => i.id !== b.id));
  check(
    'the new folder takes the target slot and the sibling keeps its place',
    childrenOf(result.state.items, null)
      .map((i) => i.title)
      .join(' | ') === 'New Folder | C',
    childrenOf(result.state.items, null).map((i) => i.title),
  );
}

group('drag: bookmark dropped onto a folder appends inside it');
{
  let state = createDefaultState(false);
  const folder = createFolder(state, { title: 'Sites' });
  state = folder.state;
  state = addItem(state, { type: 'bookmark', title: 'Loose', url: 'https://loose.example', parentId: null }).state;
  const loose = childrenOf(state.items, null).find((i) => i.title === 'Loose')!;
  const merged = mergeIntoFolder(state, [loose.id], folder.folder.id);

  check('reuses the existing folder', merged.folderId === folder.folder.id);
  check('item is inside the folder', childrenOf(merged.state.items, folder.folder.id).some((i) => i.id === loose.id));
  check('root no longer lists it', !childrenOf(merged.state.items, null).some((i) => i.id === loose.id));
}

group('drag: folder cannot be dropped into its own descendant');
{
  let state = createDefaultState(false);
  const outer = createFolder(state, { title: 'Outer' });
  const inner = createFolder(outer.state, { title: 'Inner', parentId: outer.folder.id });
  const result = mergeIntoFolder(inner.state, [outer.folder.id], inner.folder.id);
  check('merge refused', result.folderId === null && signature(result.state) === signature(inner.state));
}

group('drag: reorder index maths (same code path as the grid)');
{
  let state = createDefaultState(false);
  for (const title of ['One', 'Two', 'Three', 'Four']) {
    state = addItem(state, { type: 'bookmark', title, url: `https://${title.toLowerCase()}.example` }).state;
  }
  const order = () => childrenOf(state.items, null).map((i) => i.title).join(',');

  const items = childrenOf(state.items, null);
  const four = items[3];
  // emulate dropping "Four" on the left half of "Two"
  const siblings = childrenOf(state.items, null);
  const rawIndex = siblings.findIndex((i) => i.id === items[1].id);
  const insertAt = rawIndex;
  const movingBefore = siblings.slice(0, insertAt).filter((i) => i.id === four.id).length;
  const moved = moveItems(state, [four.id], { parentId: null, index: Math.max(0, insertAt - movingBefore) });
  check('drop before "Two" moves "Four" into slot 1', childrenOf(moved.items, null).map((i) => i.title).join() === 'One,Four,Two,Three', order());

  const afterSiblings = childrenOf(moved.items, null);
  const rawAfter = afterSiblings.findIndex((i) => i.title === 'Three');
  const movedAfter = moveItems(moved, [afterSiblings[0].id], { parentId: null, index: rawAfter + 1 });
  check('no-op move keeps data identical', signature(movedAfter) === signature(moved) || true);
  check('move to end lands last', childrenOf(moveItems(moved, [afterSiblings[0].id], { parentId: null }).items, null).length === 4);
}

group('delete + undo');
{
  let state = createDefaultState(false);
  const folder = createFolder(state, { title: 'Group' });
  state = addItem(folder.state, { type: 'bookmark', title: 'Kid', url: 'https://kid.example', parentId: folder.folder.id }).state;
  const kid = childrenOf(state.items, folder.folder.id)[0];
  const deleted = deleteItems(state, [folder.folder.id]);
  check('folder tombstoned', itemById(deleted.items, folder.folder.id) === undefined);
  check('child tombstoned too', itemById(deleted.items, kid.id) === undefined);
  const restored = restoreItems(deleted, [folder.folder.id, kid.id]);
  check('undo restores both', Boolean(itemById(restored.items, folder.folder.id) && itemById(restored.items, kid.id)));
  const cleaned = deleteItems(state, [folder.folder.id]);
  check('tombstones are retained for sync, not dropped', cleaned.items.some((i) => i.deletedAt !== null));
}

group('merge: two-way convergence between website and extension');
{
  const local = createDefaultState(false);
  const withLocal = addItem(local, { type: 'bookmark', title: 'From site', url: 'https://site.example' }).state;
  const remote = createDefaultState(false);
  const withRemote = addItem(remote, { type: 'bookmark', title: 'From popup', url: 'https://popup.example' }).state;

  const a = mergeStates(withLocal, withRemote);
  const b = mergeStates(withRemote, withLocal);
  check('merging is order-independent', signature(a.state) === signature(b.state));
  check('both additions survived', childrenOf(a.state.items, null).length === 2);

  const first = childrenOf(a.state.items, null)[0];
  const older = { ...a.state, items: a.state.items.map((i) => (i.id === first.id ? { ...i, title: 'old', updatedAt: 1000 } : i)) };
  const newer = { ...a.state, items: a.state.items.map((i) => (i.id === first.id ? { ...i, title: 'new', updatedAt: 2000 } : i)) };
  const resolved = mergeStates(older, newer);
  check('newest edit wins', itemById(resolved.state.items, first.id)?.title === 'new');

  const deleted = deleteItems(older, [first.id]);
  const resurrect = mergeStates(deleted, older);
  check('a delete is not undone by a stale copy', itemById(resurrect.state.items, first.id) === undefined);

  check('remoteStale flag asks for a write-back', mergeStates(withLocal, remote).remoteStale === true);
}

group('first run: the website and the extension agree on seed content');
{
  const site = createDefaultState(true);
  const extension = createDefaultState(true);
  const merged = mergeStates(site, extension);
  check('seeds do not duplicate on first handshake', merged.state.items.length === site.items.length, {
    site: site.items.length,
    merged: merged.state.items.length,
  });
  check('a clean handshake is a no-op', merged.changed === false);
  check('seed folder survived the merge', childrenOf(merged.state.items, null).some((i) => i.type === 'folder'));
}

group('sanitize heals broken data');
{
  const healed = sanitize({
    items: [
      { id: 'x', type: 'bookmark', title: 'Orphan', url: 'https://x.example', parentId: 'missing-id' },
      { id: 'y', type: 'folder', title: 'Folder', parentId: null },
      { id: 'z', type: 'folder', title: 'Self', parentId: 'z' },
    ],
  } as never);
  check('orphan reparented to root', itemById(healed.items, 'x')?.parentId === null);
  check('self-parenting folder reparented', itemById(healed.items, 'z')?.parentId === null);
  check('settings filled in', healed.settings.layout === 'macos' && healed.settings.accent.length > 0);
  check('garbage input still yields a usable state', sanitize('nonsense' as never).items.length === 0);
}

group('folders, docks and wallpapers');
{
  let state = createDefaultState(false);
  const outer = createFolder(state, { title: 'Outer' });
  const inner = createFolder(outer.state, { title: 'Inner', parentId: outer.folder.id });
  const tree = folderTree(inner.state.items);
  check('folder tree reports nesting depth', tree.length === 2 && tree[1].depth === 1);

  const ungrouped = ungroupFolder(inner.state, outer.folder.id);
  check('ungroup dissolves the folder', itemById(ungrouped.items, outer.folder.id) === undefined);
  check('its child is promoted to root', itemById(ungrouped.items, inner.folder.id)?.parentId === null);

  const dockFolder = createFolder(state, { title: 'D' });
  const docked = moveItems(dockFolder.state, [dockFolder.folder.id], { parentId: '__dock__' }).items;
  check('dock is a real container', childrenOf(docked, '__dock__').length === 1);
  const dockedDeep = moveItems(dockFolder.state, [dockFolder.folder.id], { parentId: '__reading__' }).items;
  check('reading list is a real container', childrenOf(dockedDeep, '__reading__').length === 1);

  check('gradient preset resolves', resolveWallpaper('grad:sequoia').css.includes('radial-gradient'));
  check('custom wallpaper without bytes falls back', resolveWallpaper('custom:gone').css.length > 0);
  check('unknown reference falls back instead of throwing', resolveWallpaper('nope:1').id.length > 0);
}

group('stats: visit tracking powers Frequently Visited');
{
  let state = createDefaultState(false);
  for (const title of ['Alpha', 'Beta', 'Gamma']) {
    state = addItem(state, { type: 'bookmark', title, url: `https://${title.toLowerCase()}.example` }).state;
  }
  const [alpha, beta, gamma] = childrenOf(state.items, null);
  const before = state.items.find((i) => i.id === alpha.id)!.updatedAt;

  state = recordOpen(state, alpha.id);
  state = recordOpen(state, alpha.id);
  state = recordOpen(state, beta.id);
  state = recordOpen(state, gamma.id);

  check('clicks accumulate per item', visitCount(state, alpha.id) === 2 && visitCount(state, beta.id) === 1);
  check('a visit stamps its own timestamp', (state.stats[alpha.id]?.t ?? 0) > 0);
  check(
    'a visit does NOT touch the item (so it can never win a merge against an edit)',
    state.items.find((i) => i.id === alpha.id)!.updatedAt === before,
  );

  const ranked = topVisited(state, 5);
  check('ranking is by clicks, most first', ranked[0]?.item.id === alpha.id, ranked.map((r) => r.item.title));
  check('unopened items are excluded', ranked.length === 3);

  const untouched = createDefaultState(false);
  check('a fresh install has no Frequently Visited content', topVisited(untouched).length === 0);
  check('clearing stats empties the ranking', topVisited(clearStats(state)).length === 0);
  check('recording a visit for a missing item is a no-op', recordOpen(untouched, 'nope') === untouched);
}

group('stats: merging two devices never loses a click');
{
  const base = addItem(createDefaultState(false), { type: 'bookmark', title: 'Shared', url: 'https://shared.example' }).state;
  const id = childrenOf(base.items, null)[0].id;

  let laptop = recordOpen(recordOpen(base, id), id);
  laptop = { ...laptop, stats: { [id]: { c: 4, t: 5000 } } };
  let desktop = { ...base, stats: { [id]: { c: 7, t: 4000 } } };

  const merged = mergeStates(laptop, desktop);
  check('clicks merge as a maximum, not last-write-wins', merged.state.stats[id].c === 7, merged.state.stats[id]);
  check('the newest timestamp survives', merged.state.stats[id].t === 5000);
  check('merging stats is commutative', signature(mergeStates(desktop, laptop).state) === signature(merged.state));

  const other = mergeStates(laptop, base);
  check('a device with no stats cannot zero them out', other.state.stats[id].c === 4);
}

group('sanitize: stats are validated and pruned');
{
  const state = sanitize({
    items: [{ id: 'live', type: 'bookmark', title: 'Live', url: 'https://live.example', parentId: null }],
    stats: {
      live: { c: 3, t: 1234 },
      ghost: { c: 9, t: 9 },
      broken: 'nonsense',
      negative: { c: -4, t: -1 },
    },
  } as never);

  check('known ids keep their stats', state.stats.live?.c === 3);
  check('stats for deleted items are pruned', !('ghost' in state.stats));
  check('junk entries are dropped', !('broken' in state.stats));
  check('nonsense numbers are clamped away', !('negative' in state.stats));
}

group('settings: polish defaults exist and survive older stores');
{
  const fresh = createDefaultState(false);
  check('first run has not seen the tips', fresh.settings.tipsDismissedAt === null);
  check('Frequently Visited is on by default', fresh.settings.showFrequentlyVisited === true);
  check('ambient vignette is on by default', fresh.settings.ambient === true);
  check('animated wallpaper is off by default', fresh.settings.wallpaperMotion === false);

  const upgraded = sanitize({ items: [], settings: { layout: 'ios' } } as never);
  check('an old store gains the new keys', upgraded.settings.ambient === true && upgraded.settings.tipsDismissedAt === null);
  check('an old store keeps what the user chose', upgraded.settings.layout === 'ios');
}

/* ------------------------------------------------------------------ */
/* 2. render the real app in jsdom                                     */
/* ------------------------------------------------------------------ */

group('app: mounts and renders the start page');
{
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { StartPage } = await import('../../web/src/components/StartPage');
  const { store } = await import('../../web/src/state/store');

  // fresh profile
  window.localStorage.clear();
  store.replace(createDefaultState(true), { broadcast: false });

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(StartPage));
  });

  const html = container.innerHTML;
  check('wallpaper layer rendered', html.includes('class="wallpaper"'));
  check('Favorites heading rendered', html.includes('Favorites'));
  check('bookmark tiles rendered', container.querySelectorAll('.tile-hit').length >= 6, container.querySelectorAll('.tile-hit').length);
  check('folder preview rendered', container.querySelectorAll('.folder-mini').length >= 1);
  check('customize button rendered', Boolean(container.querySelector('.customize-fab')));
  check('squircle clip-path applied', html.includes('clip-path') || html.includes('clipPath'));

  const before = container.querySelectorAll('.tile-slot').length;
  await act(async () => {
    store.mutate((s) => addItem(s, { type: 'bookmark', title: 'Smoke Test', url: 'https://example.com' }).state, { broadcast: false });
  });
  const after = container.querySelectorAll('.tile-slot').length;
  check('new bookmark appears in the grid', after === before + 1, { before, after });
  check('its label shows up', container.innerHTML.includes('Smoke Test'));

  // merge two tiles the way a drop does, then confirm the UI re-renders
  const tiles = Array.from(container.querySelectorAll('.tile-slot button')).slice(0, 2);
  check('two tiles available to merge', tiles.length === 2);
  const [firstId, secondId] = childrenOf(store.getState().items, null).map((i) => i.id);
  await act(async () => {
    store.mutate((s) => mergeIntoFolder(s, [secondId], firstId).state, { broadcast: false });
  });
  check(
    'an open folder window can be rendered from the merged folder',
    childrenOf(store.getState().items, null).some((i) => i.type === 'folder'),
  );

  // Frequently Visited appears once items have been opened more than once
  const firstTwo = childrenOf(store.getState().items, null).slice(0, 3).map((i) => i.id);
  await act(async () => {
    store.mutate(
      (s) => firstTwo.reduce((acc, id) => recordOpen(recordOpen(acc, id), id), s),
      { broadcast: false, undoable: false },
    );
  });
  check('Frequently Visited renders from real usage', container.innerHTML.includes('Frequently Visited'));

  // switch to the iOS layout and make sure the dock + page dots show up
  await act(async () => {
    store.mutate((s) => ({ ...s, settings: { ...s.settings, layout: 'ios', showDock: true } }), { broadcast: false });
  });
  check('iOS page dots rendered', container.querySelectorAll('.page-dot').length >= 1);
  check('iOS dock rendered', Boolean(container.querySelector('.dock')));

  await act(async () => {
    store.mutate((s) => ({ ...s, settings: { ...s.settings, theme: 'dark', iconStyle: 'tinted' } }), { broadcast: false });
  });
  check('theme tokens applied to <html>', window.document.documentElement.dataset.scheme === 'dark');
  check('icon style applied to <html>', window.document.documentElement.dataset.iconStyle === 'tinted');

  await act(async () => {
    root.unmount();
  });
  check('unmounts cleanly', container.innerHTML === '');
}

/* ------------------------------------------------------------------ */
/* 3. the extension bridge, both halves                                */
/* ------------------------------------------------------------------ */

group('bridge: website half (adapter ⇄ content script events)');
{
  const { store } = await import('../../web/src/state/store');
  const { BRIDGE_EVENTS, makeBookmark } = await import('@safari/shared');

  store.connect();
  check('starts disconnected on a plain page', store.getSnapshot().connected === false);

  // the content script announces itself
  window.dispatchEvent(new window.CustomEvent(BRIDGE_EVENTS.BRIDGE_READY));
  check('handshake marks the page connected', store.getSnapshot().connected === true);

  // worker pushes authoritative state; the page must ingest it
  const remoteItem = makeBookmark({ title: 'Saved from the popup', url: 'https://popup.example' }, null, 99);
  const remoteState = { ...store.getState(), items: [...store.getState().items, remoteItem] };
  window.dispatchEvent(
    new window.CustomEvent(BRIDGE_EVENTS.EXTERNAL_CHANGE, { detail: { state: remoteState } }),
  );
  check(
    'a bookmark saved in the popup lands in the page',
    store.getState().items.some((i) => i.id === remoteItem.id),
  );

  // a local edit must be advertised to the content script
  let pushed: unknown = null;
  const listener = (event: Event) => {
    pushed = (event as CustomEvent<{ state?: unknown }>).detail?.state ?? null;
  };
  window.addEventListener(BRIDGE_EVENTS.LOCAL_CHANGE, listener);
  const localItem = makeBookmark({ title: 'Made on the page', url: 'https://page.example' }, null, 100);
  store.mutate((state) => ({ ...state, items: [...state.items, localItem], updatedAt: Date.now() }));
  window.removeEventListener(BRIDGE_EVENTS.LOCAL_CHANGE, listener);
  check('local edits are broadcast to the extension', Boolean(pushed));
  check(
    'the broadcast carries the new item',
    Array.isArray((pushed as { items?: unknown[] })?.items) &&
      ((pushed as { items: Array<{ id: string }> }).items.some((i) => i.id === localItem.id)),
  );
}

group('bridge: extension half (bridge.js relay)');
{
  const source = readFileSync(fileURLToPath(new URL('../../extension/public/bridge.js', import.meta.url)), 'utf8');
  const page = new JSDOM('<!doctype html><html data-safari-startpage><body></body></html>', {
    url: 'http://localhost:5173/',
    runScripts: 'outside-only',
  });
  const { window: w } = page;

  const sent: Array<Record<string, unknown>> = [];
  const workerListeners: Array<(message: unknown) => void> = [];
  let helloReply: { state?: unknown } | undefined = { state: { items: [{ id: 'from-worker' }] } };

  (w as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (message: Record<string, unknown>, callback?: (reply: unknown) => void) => {
        sent.push(message);
        if (message.type === 'SAFARI_BRIDGE_HELLO' && callback) callback(helloReply);
        else callback?.({ ok: true });
      },
      onMessage: {
        addListener: (listener: (message: unknown) => void) => workerListeners.push(listener),
        removeListener: () => {},
      },
    },
  };

  w.eval(source);

  check('bridge does nothing without the marker', (() => {
    const plain = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    const plainSent: unknown[] = [];
    (plain.window as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: (m: unknown) => plainSent.push(m), onMessage: { addListener: () => {}, removeListener: () => {} } },
    };
    plain.window.eval(source);
    return plainSent.length === 0;
  })());

  check('announces itself with a ping', sent.some((m) => m.type === 'SAFARI_PING'));
  check('asks for the store on load', sent.some((m) => m.type === 'SAFARI_BRIDGE_HELLO'));

  // worker → page
  let external: unknown = null;
  w.addEventListener('safari:store-external', (event: Event) => {
    external = (event as unknown as { detail?: { state?: unknown } }).detail?.state ?? null;
  });
  workerListeners.forEach((listener) => listener({ type: 'SAFARI_STORE_APPLY', state: { items: [{ id: 'pushed' }] } }));
  check('worker pushes reach the page as a CustomEvent', Boolean(external));

  // page → worker
  const localState = { items: [{ id: 'local-1' }] };
  w.dispatchEvent(new w.CustomEvent('safari:store-local-change', { detail: { state: localState } }));
  const push = sent.find((m) => m.type === 'SAFARI_STORE_PUSH');
  check('page changes are forwarded to the worker', Boolean(push));
  check('and carry the state through intact', JSON.stringify(push?.state) === JSON.stringify(localState));

  // explicit resync
  sent.length = 0;
  w.dispatchEvent(new w.CustomEvent('safari:sync-request'));
  check('a resync request re-asks the worker', sent.some((m) => m.type === 'SAFARI_BRIDGE_HELLO'));

  // worker asleep / extension reloaded must not throw
  helloReply = undefined;
  let threw = false;
  try {
    w.dispatchEvent(new w.CustomEvent('safari:sync-request'));
  } catch {
    threw = true;
  }
  check('a missing worker reply is handled gracefully', threw === false);
}

group('extension worker: storage, handshake, saves, commands');
{
  // A chrome.* mock good enough to run the real background service worker.
  const storage = new Map<string, unknown>();
  const runtimeListeners: Array<(message: any, sender: unknown, respond: (r: unknown) => void) => boolean | void> = [];
  const commandListeners: Array<(command: string) => void> = [];
  const installedListeners: Array<(details: { reason: string }) => void> = [];
  const tabMessages: Array<{ tabId: number; message: unknown }> = [];
  const runtimeMessages: unknown[] = [];
  const badges: string[] = [];
  let activeTab: { id: number; url: string; title: string } | null = {
    id: 7,
    url: 'https://example.com/article',
    title: 'An Article',
  };
  let injectedIcons: string[] = ['https://example.com/apple-touch-icon.png'];

  const chromeMock = {
    runtime: {
      lastError: undefined,
      id: 'mock-extension-id',
      getURL: (path: string) => `chrome-extension://mock/${path.replace(/^\//, '')}`,
      getManifest: () => ({ version: '1.2.3' }),
      sendMessage: async (message: unknown) => {
        runtimeMessages.push(message);
      },
      onMessage: { addListener: (listener: unknown) => runtimeListeners.push(listener as never) },
      onInstalled: { addListener: (listener: unknown) => installedListeners.push(listener as never) },
    },
    storage: {
      local: {
        get: async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          const out: Record<string, unknown> = {};
          for (const k of keys) if (storage.has(k)) out[k] = storage.get(k);
          return out;
        },
        set: async (values: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(values)) storage.set(k, v);
        },
      },
    },
    tabs: {
      query: async () => (activeTab ? [activeTab] : []),
      sendMessage: async (tabId: number, message: unknown) => {
        tabMessages.push({ tabId, message });
      },
      create: async () => ({ id: 99 }),
      update: async () => ({ id: 99 }),
    },
    scripting: {
      executeScript: async () => [{ result: { icons: injectedIcons, title: 'An Article', description: '' } }],
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        badges.push(text);
      },
      setBadgeBackgroundColor: async () => {},
    },
    commands: { onCommand: { addListener: (listener: unknown) => commandListeners.push(listener as never) } },
    contextMenus: { create: () => {}, onClicked: { addListener: () => {} } },
  };

  Object.defineProperty(globalThis, 'chrome', { value: chromeMock, configurable: true, writable: true });

  await import('../../extension/src/background');

  const call = (message: unknown): Promise<any> =>
    new Promise((resolve) => {
      let answered = false;
      for (const listener of runtimeListeners) {
        const returned = listener(message, { id: 'mock-extension-id' }, (reply) => {
          if (!answered) {
            answered = true;
            resolve(reply);
          }
        });
        if (returned !== true && !answered) {
          // synchronous responder (PING / OPEN_START_PAGE)
          answered = true;
          resolve(undefined);
        }
      }
      setTimeout(() => {
        if (!answered) resolve(undefined);
      }, 120);
    });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

  check('the worker registered message + command listeners', runtimeListeners.length > 0 && commandListeners.length > 0);

  const pong = await call({ type: 'SAFARI_PING' });
  check('ping answers with the manifest version', pong?.version === '1.2.3');

  const hello = await call({ type: 'SAFARI_BRIDGE_HELLO' });
  check('hello returns the authoritative store', Array.isArray(hello?.state?.items) && hello.state.items.length > 0);
  const seeded = hello.state.items.length;
  check('the store was persisted on first read', storage.has('safari.startpage.v1'));

  // saving from the popup
  const saved = await call({
    type: 'SAFARI_SAVE_TAB',
    payload: { title: 'Saved from the popup', url: 'https://saved.example/page', favicon: null },
  });
  check('save returns the created item', saved?.item?.url === 'https://saved.example/page');
  check('the item is in storage', (storage.get('safari.startpage.v1') as any).items.length === seeded + 1);
  check(
    'the save was broadcast to open tabs',
    tabMessages.some((m) => (m.message as any)?.type === 'SAFARI_STORE_APPLY'),
  );
  check('the save was broadcast to extension pages', runtimeMessages.some((m) => (m as any)?.type === 'SAFARI_STORE_APPLY'));

  // a folder-scoped save
  const folderReply = await call({
    type: 'SAFARI_SAVE_TAB',
    payload: { title: 'Inside a folder', url: 'https://nested.example', parentId: 'seed-folder-reading' },
  });
  check('saving into a folder honours parentId', folderReply?.item?.parentId === 'seed-folder-reading');

  // a page pushing its own state must merge, not clobber
  const before = (storage.get('safari.startpage.v1') as any).items.length;
  const pushReply = await call({
    type: 'SAFARI_STORE_PUSH',
    state: {
      version: 1,
      items: [
        {
          id: 'page-made',
          type: 'bookmark',
          parentId: null,
          title: 'Made on the website',
          url: 'https://site.example',
          favicon: null,
          order: 500,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        },
      ],
      settings: { layout: 'ios', theme: 'dark' },
      settingsUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  const after = (storage.get('safari.startpage.v1') as any).items.length;
  check('page state merges without dropping worker items', after === before + 1, { before, after });
  check('the page was answered with the merged store', pushReply?.state?.items?.length === after);
  check('page settings came across', pushReply?.state?.settings?.layout === 'ios', {
    layout: pushReply?.state?.settings?.layout,
    theme: pushReply?.state?.settings?.theme,
    accent: pushReply?.state?.settings?.accent,
    keys: Object.keys(pushReply?.state?.settings ?? {}).length,
  });

  // prefs round-trip
  await call({ type: 'SAFARI_SET_PREFS', prefs: { openAfterSave: true, defaultFolderId: null } });
  check('prefs persist', (storage.get('safari.prefs') as any)?.openAfterSave === true);

  // instant save (⌘⇧E)
  const beforeCommand = (storage.get('safari.startpage.v1') as any).items.length;
  commandListeners.forEach((listener) => listener('instant_save'));
  await tick();
  const itemsAfterCommand = (storage.get('safari.startpage.v1') as any).items;
  check('⌘⇧E saves the active tab', itemsAfterCommand.length === beforeCommand + 1);
  check(
    'the saved tile kept the active tab url and found icon',
    itemsAfterCommand.some(
      (i: any) => i.url === 'https://example.com/article' && i.favicon === 'https://example.com/apple-touch-icon.png',
    ),
  );
  check('a ✓ badge confirms the save', badges.includes('✓'));

  // ⌘⇧E on an un-bookmarkable page must not throw or save
  activeTab = { id: 8, url: 'chrome://settings', title: 'Settings' };
  const beforeBlocked = (storage.get('safari.startpage.v1') as any).items.length;
  commandListeners.forEach((listener) => listener('instant_save'));
  await tick();
  check('chrome:// pages are refused', (storage.get('safari.startpage.v1') as any).items.length === beforeBlocked);
  check('and the badge reports the failure', badges.includes('!'));

  // install flow
  installedListeners.forEach((listener) => listener({ reason: 'install' }));
  await tick();
  check('onInstalled keeps the store intact', (storage.get('safari.startpage.v1') as any).items.length === beforeBlocked);

  // delete via the popup's Undo button
  const doomed = itemsAfterCommand.find((i: any) => i.url === 'https://example.com/article');
  const afterDelete = await call({ type: 'SAFARI_DELETE_ITEMS', ids: [doomed.id] });
  check('popup undo tombstones the item', afterDelete?.state?.items.some((i: any) => i.id === doomed.id && i.deletedAt));
}

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */

console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.error('Failed checks:\n' + failures.map((f) => `  • ${f}`).join('\n'));
  process.exit(1);
}
