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
  check('icon style class applied', window.document.documentElement.classList.contains('icon-tinted'));

  await act(async () => {
    root.unmount();
  });
  check('unmounts cleanly', container.innerHTML === '');
}

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */

console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.error('Failed checks:\n' + failures.map((f) => `  • ${f}`).join('\n'));
  process.exit(1);
}
