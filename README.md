# Safari Start Page + Quick Save extension

An Apple-styled Safari start page as a **website**, plus a **Chrome extension** that
saves any tab into it — from the toolbar, from a popup shortcut, or from a global
hotkey. Bookmarks can be dragged onto each other to form iOS-style folders. No
accounts, no server, everything stays in your browser.

```
┌─ the website ──────────────────────────┐   ┌─ the extension ─────────────────┐
│  macOS Safari Start Page   ·   iOS     │   │  ⌘⇧S  popup for the active tab  │
│  Favorites grid · folders · drag/merge │◄──┤  ⌘⇧E  instant save (no popup)   │
│  13 wallpapers · light/dark · tinted   │   │  ⌘⇧Space  open the start page   │
│  search · reading list · import/export │   │  optional new-tab replacement   │
└────────────────────────────────────────┘   └─────────────────────────────────┘
```

The full design/architecture write-up is in **[PLAN.md](./PLAN.md)**. This file is the
practical guide.

---

## 1. Quick start

```bash
npm install          # installs the two workspaces (web, extension)
npm run build        # builds the website AND the loadable extension
```

### a) Run the website

```bash
npm run dev          # http://localhost:5173  (hot reload)
# or, after a build:
npm run build:web && npm run serve:web        # static server on :4173
```

A visitor who has never installed anything still gets a working start page seeded with
a few favorites, a demo folder, and six wallpapers to play with.

### b) Install the extension

1. `npm run build:ext` (already done by `npm run build`)
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → choose the **`extension/release`** folder
4. Pin the extension. Press **⌘⇧S** (Ctrl+Shift+S on Windows/Linux) on any page.

The built extension is committed, so `extension/release` can be loaded straight from a
clone. Rebuild after editing extension code (`npm run dev:ext` keeps rebuilding).

### c) Optional: make it your New Tab page

The extension ships with the new-tab override **off**. Turn it on with:

```bash
npm run newtab on     # edits both manifests
# then click "Reload" on chrome://extensions
npm run newtab off    # back to Chrome's normal new tab
npm run newtab status # see the current state
```

---

## 2. Using it

### Save a page into the start page

| How | What happens |
| --- | --- |
| **⌘⇧S** or click the toolbar icon | Popup: edit the title, pick a destination folder, Save |
| **⌘⇧E** | Saves instantly and flashes a ✓ badge — no popup |
| Right-click a page | *Save Page to Safari Start Page* |
| Right-click a link | *Save Link to Safari Start Page* |
| On the start page | **+ Bookmark**, **⌘N**, or drag a link from any tab onto the grid |

Saves appear instantly in every open start-page tab (and on the new-tab page if the
override is on). **⌘⇧Space** opens the start page from anywhere; the popup also has an
*Open start page after saving* switch, remembered across sessions.

### Drag & merge (the folder gesture)

| Gesture | Result |
| --- | --- |
| Drag a tile onto another tile, **drop quickly** | Reorders — an accent bar shows where it will land |
| Drag a tile onto another tile and **hold for ~0.4 s** | The target grows and shows a halo: drop now and a folder is created in its place containing both |
| Drag a tile onto an **existing folder** | It drops inside |
| Drag a tile into an open folder window | Nested folder |
| Drag a tile out of a folder window onto the dimmed backdrop | Popped back out to the grid |
| Drop a tile on a **page dot** (iOS layout) | Moves it to that page |
| Drop a tile on the **Dock** (iOS layout) | Pins it to the Dock |
| Long-press the grid (touch) / **Edit Layout** | Jiggle mode with × badges to delete |

Select several tiles with ⌘/Ctrl/Shift-click first and the whole group merges or moves
as one.

### Customise

The bottom-right slider button opens the glass customizer: layout (macOS/iOS), wallpapers,
upload your own (downscaled to 2560 px, stored in IndexedDB), light/dark/auto, icon style
(colour / dark / tinted), accent colour, glass blur, wallpaper dim, columns & rows, which
sections show, search engine, and the Favorites heading.

### Keyboard shortcuts

On the start page:

| Keys | Action |
| --- | --- |
| `⌘N` / `⇧⌘N` | New bookmark / new folder |
| `⌘Z` / `⇧⌘Z` | Undo / redo (60 steps, covers deletes, merges, moves) |
| `Delete` / `⌫` | Delete the selection (undoable from the toast) |
| `/` | Focus search (when the search field is on) |
| `Esc` | Close the folder window / menu / clear selection |
| Right-click | Context menu: open, copy link, rename, duplicate, move to…, dissolve folder, delete |

Elsewhere (extension commands):

| Keys | Action |
| --- | --- |
| `⌘⇧S` | Quick Save popup for the current tab |
| `⌘⇧E` | Save the current tab silently |
| `⌘⇧Space` | Open the Safari Start Page |

> Chrome only accepts these accelerator shapes for `_execute_action`. If a shortcut
> clashes with another extension, rebind it at `chrome://extensions/shortcuts` — or edit
> `extension/public/manifest.json` → `commands` and rebuild.

---

## 3. Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install workspaces (web + extension) |
| `npm run dev` | Website dev server on :5173, hot reload |
| `npm run dev:ext` | Rebuild `extension/release` on every change |
| `npm run build` | Build both the website and the extension |
| `npm run build:web` | Website → `web/release/` |
| `npm run build:ext` | Extension → `extension/release/` (load this unpacked) |
| `npm run serve:web` | Zero-dependency static server for the built site |
| `npm test` | 89 checks: store algorithms, a jsdom render of the real app, the extension bridge and the real service worker |
| `npm run typecheck` | `tsc --noEmit` for both workspaces |
| `npm run newtab on\|off\|status` | Toggle the new-tab override |
| `node scripts/make-icons.mjs` | Regenerate the extension/app icons (pure Node PNG writer) |

---

## 4. Repository layout

```
shared/src/          THE single source of truth for both apps
  types.ts           Item / StoreState / Settings, storage key, bridge protocol
  store.ts           every state transition (add, move, mergeIntoFolder, delete, sanitize…)
  merge.ts           local-first reconciliation with tombstones
  favicon.ts         icon candidates, letter-tile fallback, in-page icon scraper
  wallpapers.ts      13 Apple-era gradient presets
  wallpaper-db.ts    IndexedDB blobs + downscaling for uploads
  bookmarks-html.ts  Chrome bookmark-file import/export
  adapter.ts         website half of the extension bridge

web/                 the start page website
  src/components/    StartPage, Tiles, FolderOverlay, CustomizePanel, ContextMenu, Dialogs, Panels
  src/state/         store wrapper (undo, toasts, persistence) + React hooks
  src/lib/           squircle geometry, favicon hooks, small helpers
  src/styles.css     the whole Apple design system

extension/           the Chrome MV3 extension
  public/manifest.json  MV3 manifest (permissions, commands, new-tab override)
  public/bridge.js      content script that relays the website ⇄ worker
  src/background.ts     service worker: authoritative store, commands, context menus
  src/popup/            the Quick Save sheet
  src/newtab/           new-tab entry that renders the very same StartPage component
  release/              built extension — "Load unpacked" this folder

scripts/             serve · icon generator · new-tab toggle · smoke tests
```

---

## 5. How your data is stored (and backed up)

| Data | Where |
| --- | --- |
| Bookmarks, settings | website: `localStorage['safari.startpage.v1']` · extension: `chrome.storage.local` (same JSON shape) |
| Custom wallpaper images | IndexedDB (`safari-startpage` → `wallpapers`), downscaled WebP |
| Nothing else | no analytics, no network calls except the favicon service / the sites you open |

**Backups:** *Import / Export* in the toolbar (or right-click → Import/Export) gives you a
JSON snapshot, a Chrome-compatible bookmarks HTML file, and clipboard copy. Import
accepts a Chrome **Bookmarks → Export bookmarks** HTML file (folders and all) or a JSON
backup, and merges it into the current page.

Because both sides speak the same format, restoring onto a new machine is: install the
extension, open the start page, Import.

---

## 6. Troubleshooting

**The status pill says "Local only — install the extension".**
The website could not hear from the extension. Check that (a) the extension is loaded
and enabled, (b) you are on `http://localhost:5173` or `http://127.0.0.1:…`, and (c) the
tab was opened *after* the extension was installed (content scripts do not inject into
already-open tabs — reload once). On another host, add that host to
`content_scripts[].matches` and `host_permissions` in `extension/public/manifest.json`
and rebuild. Saving from the popup works everywhere regardless.

**The new tab is still Chrome's.**
`npm run newtab on` then reload the extension in `chrome://extensions`. `npm run newtab status`
shows what the manifests currently say.

**Icons look blurry.**
Some sites only ship a 16 px favicon. The extension asks the page for its
`apple-touch-icon` first, then falls back to Chrome's cached icon and the favicon
service; if all three fail you get a generated letter tile. You can always fix one tile
by hand: right-click → *Rename…* won't change the icon, but re-saving with **⌘⇧S** while
the page is focused usually picks up the better icon.

**A drag merged tiles I did not want merged.**
It only merges after ~0.4 s of hovering — dropping fast just reorders. If it still
happens, press **⌘Z**: merges are undoable, splits included (*Dissolve Folder* in the
context menu).

**Deletes vanished my folder and its contents.**
They are tombstoned, not erased: the toast's **Undo** restores the whole subtree for 6 s,
and **⌘Z** restores it afterwards.

**Wallpaper upload did nothing.**
Very large images are downscaled to 2560 px first; if IndexedDB is blocked (some
incognito/enterprise policies) the upload is refused with a message. Gradient wallpapers
always work.

---

## 7. Status

Built and verified in this repo: shared core, website (both layouts, drag-merge, undo,
import/export, customizer), extension (popup, worker, bridge, new-tab, context menus,
commands), generated icons, and a smoke-test suite that mounts the real app, drives
`bridge.js` against a fake content-script channel, and runs the actual service worker
against a mocked `chrome.*` API.

Not included on purpose (see PLAN.md §10): cloud sync/accounts, cross-profile Chrome
sync, real-Safari `.appex` packaging, per-folder icons.
