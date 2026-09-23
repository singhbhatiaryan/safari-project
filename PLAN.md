# Safari Start Page — architecture & build plan

> An Apple-styled start page (website) plus a Chrome MV3 extension that puts any tab
> into it with one keystroke. No accounts, no server, no analytics.

This document is the plan the implementation follows. Every section links to the
files that make it real, so you can jump from "how it works" to "where it lives".

---

## 1. Goals, and the decisions taken

| Requirement (as asked) | How it is met |
| --- | --- |
| "Exact Apple Safari-styled home page" | macOS Safari **Start Page** layout *and* an **iOS Home Screen** layout, switchable at runtime. Real superellipse ("squircle") clip-paths, vibrancy/blur glass, SF-first font stack, Apple accent palette, spring physics. |
| "Save bookmarks to this page from the current tab" | Popup (**⌘⇧S**) and instant save (**⌘⇧E**) for the active tab; right-click a page or link → *Save to Safari Start Page*. |
| "Drag and merge bookmarks to make a folder" | Drag one tile onto another: a dwell timer (**420 ms**) turns the target into a merge target, the drop builds an iOS-style folder that opens in place. Dropping onto an *existing* folder appends to it. Dropping onto a folder's backdrop pops items back out. |
| "Keep the themes and wallpapers Apple styled" | 13 macOS-era gradient wallpapers (Sequoia, Sonoma, Ventura, Big Sur, Monterey, Tahoe…), custom wallpaper upload (downscaled, stored in IndexedDB), light/dark/auto, color/dark/tinted icon styles, glass-blur and dim sliders, accent colours. |
| "A shortcut that opens the popup on any tab" | `_execute_action` → **⌘⇧S** (Chrome's own binding, works on any tab, no host permissions). |
| "Open the Safari home page when shortcuts are pressed" | **⌘⇧Space** → opens the start page. **⌘⇧E** saves *and* can open the start page (toggle in the popup, persisted). |
| "The page is a website and works with the extension to save bookmarks to it" | The extension is the authoritative store; a content-script bridge syncs any open start-page tab in ~50 ms both ways. See §4. |

Deliberate deviations from the first sketch (all for correctness/simplicity):

1. **No backend / no auth.** Local-first with last-write-wins merge + tombstones
   (`shared/src/merge.ts`). Adding Supabase later means swapping one module.
2. **Vanilla `@dnd-kit` sensors rather than a drag library for the grid.** The site
   and the extension share the *same* `StartPage` component, so the drag logic exists
   once (`web/src/components/StartPage.tsx`).
3. **Extension = thin shell, site = the product.** `extension/src/newtab/main.tsx`
   imports `@web/components/StartPage` directly, so the two renderers can never drift.

---

## 2. System shape

```
┌──────────────────────────────────────────────────────────────────────────┐
│ CHROME MV3 EXTENSION                                                     │
│                                                                          │
│  popup.html  ← ⌘⇧S / toolbar click      newtab.html (optional override)  │
│  Quick Save sheet                        = the SAME StartPage component  │
│         │                                        ▲                       │
│         │ chrome.runtime.sendMessage             │ chrome.runtime msg    │
│         ▼                                        │                       │
│  background.ts  (service worker)  ── THE authoritative store ──          │
│   • chrome.storage.local['safari.startpage.v1']                          │
│   • mergeStates() on every write, then broadcast to every tab            │
│   • ⌘⇧E instant save · ⌘⇧Space open page · context menus · badge feedback │
│         │                                                                │
│         │ tabs.sendMessage({type:'SAFARI_STORE_APPLY'})                  │
│         ▼                                                                │
│  bridge.js  (content script on localhost / your own domain)              │
│   window CustomEvents  ⇄  chrome.runtime messages                        │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ CustomEvents (no postMessage, no secrets)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ WEBSITE (vite dev server or static build)                                │
│  StartPage.tsx → store.ts (localStorage) → adapter.ts → bridge           │
│  Wallpapers in IndexedDB · undo stack · toasts · import/export           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Why the website keeps its own copy

The extension may be absent (plain browsing), the site may be opened on a machine
where it is hosted, and multiple tabs must agree. So both sides own a full
`StoreState` and reconcile with the same pure function:

```
local ─┐
       ├─ mergeStates(local, remote)  →  { state, changed, remoteStale }
remote ┘
```

* per-item **last-write-wins** on `updatedAt`, deterministic tie-break on serialised
  content so two browsers reach byte-identical results;
* **tombstones** (`deletedAt`, kept 30 days) stop a stale tab from resurrecting a
  deleted bookmark;
* `remoteStale` tells the receiver to push back, which is how a fresh install
  re-seeds the other side.

---

## 3. Data model (`shared/src/types.ts`)

```ts
interface Item {
  id: string;
  type: 'bookmark' | 'folder';
  parentId: string | null;   // null = Favorites grid; '__dock__' | '__reading__' are virtual containers
  title: string;
  url: string | null;        // folders have null
  favicon: string | null;    // resolved hi-res icon
  order: number;             // position inside its container
  createdAt: number;
  updatedAt: number;         // drives merge
  deletedAt: number | null;  // tombstone
}

interface StoreState {
  version: 1;
  items: Item[];
  settings: Settings;        // layout, theme, wallpaper, icon style, section toggles…
  settingsUpdatedAt: number;
  updatedAt: number;
}
```

One flat array + `parentId` is what makes the whole feature set cheap:

| Feature | Implementation |
| --- | --- |
| Nested folders, any depth | `childrenOf(items, parentId)` |
| Dock & Reading List | virtual parents `__dock__` / `__reading__` — every move/merge algorithm works unchanged |
| Reorder by drag | `reorderContainer` / `moveItems(parentId, index)` |
| Delete with undo | `deleteItems` (tombstones subtree) + `restoreItems` |
| Guard against cycles | `collectDescendants` refuses to move a folder into itself |
| Broken/imported data | `sanitize()` reparents dangling + self-referencing nodes, normalises orders |

**Wallpaper bytes never enter this document.** Only `{id, name, mime, width, height}`
metadata does; the pixels live in IndexedDB (`safari-startpage/wallpapers`). That keeps
`localStorage` (~5 MB) and `chrome.storage.local` (~10 MB) well clear of a 20 MB photo.

---

## 4. Sync protocol (`shared/src/types.ts`, `shared/src/adapter.ts`, `bridge.js`)

| Direction | Website ⇄ | Extension page |
| --- | --- | --- |
| push local change | `CustomEvent('safari:store-local-change')` → bridge → worker | `chrome.runtime.sendMessage({type:'SAFARI_STORE_PUSH'})` |
| receive truth | bridge → `CustomEvent('safari:store-external')` | `chrome.runtime.onMessage(SAFARI_STORE_APPLY)` |
| handshake | `SAFARI_BRIDGE_HELLO` → worker replies `{state}` | same |

* Message names live in both `shared/src/types.ts` and `extension/public/bridge.js`
  (the bridge is a classic script, so it cannot import the bundle). A comment on each
  side marks them as a matched pair.
* `manifest.json` injects the bridge only into `http://localhost/*` and
  `http://127.0.0.1/*`. **Hosting the page?** Add your domain to `content_scripts[].matches`
  and `host_permissions` — that is the only change needed for live sync on a real domain.
* Without the extension the page is simply local-only; the status pill in the toolbar
  says which mode you are in.

---

## 5. Gestures (`web/src/components/StartPage.tsx`)

```
drag start ──► active tile lifts (DragOverlay ghost, springs, multi-select aware)

drag over tile A ──► 0 ms   ─ insertion bar (before | after, by pointer side)
                    420 ms ─ "merge target": A scales to 1.16, accent halo
                                │
drag over a container ──► drop = move into that container (folder / dock / reading list)
drag over a page dot ──► dwell = flip to that iOS page, drop = move there

drop ──► merge target?  → mergeIntoFolder()  → new folder (bookmark target)
                                             → append inside (folder target)
      → tile?            → moveItems([] , index)  reorder
      → container?       → moveItems([], parentId)
      → page dot?        → moveItems([], index = page × rows × columns)
```

Details that matter in practice:

* The merge timer keys off *target change*, not the raw dragover stream — otherwise a
  stationary pointer would reset it forever and the folder never forms.
* Multi-select (`⌘`/`Ctrl`/`Shift` click) lifts the whole group; a merge with 3 selected
  tiles makes one folder holding all 3.
* `Merge` never deletes: it moves. `Delete` tombstones, and the toast offers **Undo**.
* iOS **jiggle/edit mode** (long-press the grid, or *Edit Layout*) reveals the × badges.

---

## 6. Favicon pipeline (`shared/src/favicon.ts`)

Large squircles expose tiny favicons, so quality is resolved in this order:

1. `chrome.scripting.executeScript(collectPageIcons)` reads the page's
   `rel="apple-touch-icon"` / `sizes`-scored icons → usually 180–512 px. *(popup + worker)*
2. `chrome://favicon?size=128` via the `favicon` permission — Chrome's cached icon,
   available even for pages we cannot inject into.
3. Google's favicon service `…&sz=128`.
4. A generated SVG letter tile (`letterAvatar`) with a deterministic tint — so an
   offline page still looks like an app icon instead of a broken image.

Every `<img>` walks the candidate list on `onError`, so a blocked third-party request
degrades instead of breaking the tile.

---

## 7. The two layouts

| | macOS **Safari Start Page** | **iOS Home Screen** |
| --- | --- | --- |
| Grid | responsive columns (auto-fits, honours the Columns setting) | fixed columns × rows, **paged** |
| Labels | under each tile | optional |
| Extras | search field, Reading List, Privacy Report section | page dots, Dock at the bottom, jiggle mode |
| Drag extras | drop on grid = Favorites | drop on a page dot = that page, drop on Dock = dock it |

Both render the *same* `Tile` component; only the container, sizes and chrome differ.
Everything you can do in one layout you can do in the other.

---

## 8. Where the "Apple look" comes from (`web/src/styles.css`, `web/src/lib/squircle.ts`)

* **True squircle geometry** — superellipse `|x|ⁿ+|y|ⁿ=1` (n≈5) sampled into a
  `clip-path`, because `border-radius` cannot express Apple's continuous curve. Same
  radius maths drives the extension icon generator (`scripts/make-icons.mjs`).
* **Vibrancy** — `backdrop-filter: blur() saturate(190%)` on three tiers of glass
  (`--glass`, `--glass-strong`, menus) with a `@supports` fallback to opaque.
* **SF type ramp** — `-apple-system → SF Pro Text → Helvetica Neue → Inter`; labels get
  `text-shadow` instead of a plate so they stay legible over any wallpaper.
* **Light-on-light wallpapers** switch labels to dark ink (`.contrast-ink`).
* **Springs** — `cubic-bezier(0.32,0.72,0,1)` for hovers/press, `motion` springs for
  folder open, toasts and layout changes; *Reduce motion* disables all of it.
* Every token is a CSS custom property, so the customizer mutates one element
  (`document.documentElement`) instead of re-rendering the tree.

---

## 9. Build order (all complete)

1. **Shared core** — types, store, merge, favicon, wallpapers, IndexedDB, import/export.
2. **Website** — design system, tiles, drag engine, folder window, customizer, dialogs,
   keyboard shortcuts, undo/toasts.
3. **Extension** — manifest, service worker, content-script bridge, popup, new-tab page,
   icon generator, new-tab toggle script.
4. **Verification** — `npm run typecheck`, `npm test` (89 checks: the pure algorithms, a real
   jsdom render of the app, both halves of the bridge, and the service worker run against a
   mocked `chrome.*` API), `npm run build`.

## 10. Deliberately out of scope (easy next steps)

* Chrome Sync across profiles — `chrome.storage.sync` (8 KB/item quota) or a hosted store.
* Drag-to-reorder *within a folder window* uses the same engine as the grid; the only
  thing missing is a per-window "sort" menu.
* Safari/WebExtension packaging for real macOS Safari (`safari-web-extension-converter`
  eats a Chrome MV3 folder almost unchanged — the bridge matches list is the only edit).
* Folder colour/emoji badges, per-page iOS wallpapers.
