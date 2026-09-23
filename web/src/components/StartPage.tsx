import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { AnimatePresence, motion } from 'motion/react';
import {
  DOCK_ID,
  Item,
  READING_ID,
  StoreState,
  childrenOf,
  clearStats,
  collectDescendants,
  createFolder,
  deleteItems,
  itemById,
  liveItems,
  mergeIntoFolder,
  moveItems,
  recordOpen,
  requestBridgeSync,
  resolveWallpaper,
  restoreItems,
  uid,
} from '@safari/shared';
import { store } from '../state/store';
import { useChildren, useDwell, useElementWidth, useSettings, useStartPage, useSystemTheme } from '../state/hooks';
import { useLongPress, useWallpaperUrls } from '../lib/hooks-lib';
import {
  activeGrid,
  chunk,
  focusTile,
  focusedTileIndex,
  gridColumns,
  nextIndex,
  tilesIn,
  type Direction,
} from '../lib/navigation';
import { AddTile, GhostIcon, Tile, type Indicator } from './Tiles';
import { ContextMenu, type ContextMenuActions, type MenuTarget } from './ContextMenu';
import { FolderOverlay } from './FolderOverlay';
import { CustomizePanel } from './CustomizePanel';
import {
  ConfirmSheet,
  EditSheet,
  ImportExportSheet,
  type ConfirmState,
  type EditSheetState,
} from './Dialogs';
import { PrivacyReport, ReadingList, SearchField, Toasts } from './Panels';
import { SlidersGlyph, Toolbar } from './Toolbar';
import { HelpSheet } from './HelpSheet';
import { FrequentlyVisited } from './FrequentlyVisited';
import { SelectionBar } from './SelectionBar';

const MERGE_DWELL_MS = 420;
const ITEM_PREFIX = 'item:';
const CONTAINER_PREFIX = 'container:';
const PAGE_PREFIX = 'page:';
const PAGE_WHEEL_LOCK_MS = 380;

const containerKey = (parentId: string | null): string => `${CONTAINER_PREFIX}${parentId ?? 'root'}`;
const containerFromKey = (key: string): string | null => {
  const raw = key.slice(CONTAINER_PREFIX.length);
  return raw === 'root' ? null : raw;
};

const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

export function StartPage() {
  const { state, connected, canUndo, canRedo, toasts } = useStartPage();
  const settings = useSettings();
  const systemTheme = useSystemTheme();
  const scheme = settings.theme === 'system' ? systemTheme : settings.theme;

  /* ---------------- mirrors so callbacks can stay identity-stable ---------------- */
  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------------- wallpaper + theme tokens ---------------- */
  const customUrls = useWallpaperUrls(settings.wallpapers.map((w) => w.id));
  const wallpaper = useMemo(() => resolveWallpaper(settings.wallpaper, customUrls), [settings.wallpaper, customUrls]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.scheme = scheme;
    root.dataset.iconStyle = settings.iconStyle;
    root.classList.toggle('contrast-ink', wallpaper.scheme === 'light');
    root.classList.toggle('reduce-motion', settings.reduceMotion);
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--dim', `${settings.dim}%`);
    root.style.setProperty('--blur', `${settings.blur}px`);
    root.style.setProperty('--tile', settings.layout === 'macos' ? '76px' : '62px');
  }, [scheme, settings, wallpaper.scheme]);

  /* ---------------- data slices ---------------- */
  const favorites = useChildren(null);
  const dockItems = useChildren(DOCK_ID);
  const readingItems = useChildren(READING_ID);
  const allItems = useMemo(() => liveItems(state.items), [state.items]);

  /* ---------------- ui state ---------------- */
  const [selection, setSelection] = useState<string[]>([]);
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const selectionRef = useRef(selectionSet);
  selectionRef.current = selectionSet;

  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [editSheet, setEditSheet] = useState<EditSheetState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [sheet, setSheet] = useState<'tips' | 'help' | null>(null);
  const [jiggle, setJiggle] = useState(false);
  const [iosPage, setIosPage] = useState(0);
  const [pageDirection, setPageDirection] = useState(1);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const openFolder = openFolderId ? itemById(state.items, openFolderId) ?? null : null;
  const selectedItems = useMemo(
    () => selection.map((id) => itemById(state.items, id)).filter((i): i is Item => Boolean(i)),
    [selection, state.items],
  );

  /* ---------------- first run: show the tips once ---------------- */
  const markTipsSeen = useCallback(() => {
    if (settingsRef.current.tipsDismissedAt !== null) return;
    store.mutate((s) => ({
      ...s,
      settings: { ...s.settings, tipsDismissedAt: Date.now() },
      settingsUpdatedAt: Date.now(),
    }));
  }, []);

  useEffect(() => {
    if (settingsRef.current.tipsDismissedAt === null) setSheet('tips');
  }, []);

  /* ---------------- drag state ---------------- */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [overItemId, setOverItemId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<Indicator>(null);
  const dwell = useDwell(MERGE_DWELL_MS);
  const dwellRef = useRef<string | null>(null);
  const dragIdsRef = useRef<string[]>([]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const activeItem = activeId ? itemById(state.items, activeId) : null;
  const mergeTargetId = overItemId && dwell.target === overItemId && !dragIds.includes(overItemId) ? overItemId : null;

  const collisionDetection = useCallback<CollisionDetection>((args) => {
    // Prefer whatever is under the pointer; tiles beat containers, pages beat both
    // only when nothing else is hit (dots live in their own strip).
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length) {
      const itemHits = pointerCollisions.filter((c) => String(c.id).startsWith(ITEM_PREFIX));
      if (itemHits.length) return itemHits;
      const containerHits = pointerCollisions.filter((c) => String(c.id).startsWith(CONTAINER_PREFIX));
      if (containerHits.length) return containerHits;
      return pointerCollisions;
    }
    return rectIntersection(args);
  }, []);

  const resetDragState = useCallback(() => {
    setActiveId(null);
    setDragIds([]);
    setOverItemId(null);
    setIndicator(null);
    dwell.reset();
    dwellRef.current = null;
  }, [dwell]);

  const handleDragStart = (event: DragStartEvent) => {
    const itemId = (event.active.data.current as { itemId?: string } | undefined)?.itemId;
    if (!itemId) return;
    const snapshot = stateRef.current;
    const item = itemById(snapshot.items, itemId);
    if (!item) return;
    const current = selectionRef.current;
    const group = (current.has(itemId) ? [...current] : [itemId])
      .map((id) => itemById(snapshot.items, id))
      .filter((i): i is Item => Boolean(i))
      .filter((i) => i.parentId === item.parentId)
      .map((i) => i.id);
    const ids = group.length ? group : [itemId];
    dragIdsRef.current = ids;
    setDragIds(ids);
    setActiveId(itemId);
    if (ids.length === 1) setSelection([]);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) {
      dwell.reset();
      dwellRef.current = null;
      setOverItemId(null);
      setIndicator(null);
      return;
    }

    if (overId.startsWith(ITEM_PREFIX)) {
      const targetId = overId.slice(ITEM_PREFIX.length);
      setOverItemId(targetId);

      if (dragIdsRef.current.includes(targetId)) {
        dwellRef.current = null;
        dwell.reset();
        setIndicator(null);
        return;
      }

      const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
      const overRect = event.over?.rect ?? null;
      if (activeRect && overRect) {
        const activeCenter = activeRect.left + activeRect.width / 2;
        const overCenter = overRect.left + overRect.width / 2;
        setIndicator(activeCenter < overCenter ? 'before' : 'after');
      }

      // Only (re)start the merge timer when the hovered target changes, otherwise
      // the continuous dragover stream would keep resetting it forever.
      if (dwellRef.current !== targetId) {
        dwellRef.current = targetId;
        dwell.setTarget(targetId);
      }
      return;
    }

    if (overId.startsWith(CONTAINER_PREFIX)) {
      setOverItemId(null);
      setIndicator(null);
      dwellRef.current = null;
      dwell.reset();
      return;
    }

    if (overId.startsWith(PAGE_PREFIX)) {
      const page = Number(overId.slice(PAGE_PREFIX.length));
      setOverItemId(null);
      setIndicator(null);
      if (dwellRef.current !== overId) {
        dwellRef.current = overId;
        dwell.setTarget(overId);
        window.setTimeout(() => changePage(page), MERGE_DWELL_MS);
      }
    }
  };

  const applyMoveToPosition = (ids: string[], targetId: string, side: 'before' | 'after') => {
    const snapshot = store.getState();
    const target = itemById(snapshot.items, targetId);
    if (!target) return;
    const siblings = childrenOf(snapshot.items, target.parentId);
    const rawIndex = siblings.findIndex((i) => i.id === targetId);
    if (rawIndex < 0) return;
    const insertAt = rawIndex + (side === 'after' ? 1 : 0);
    const movingBefore = siblings.slice(0, insertAt).filter((i) => ids.includes(i.id)).length;
    store.mutate((s) => moveItems(s, ids, { parentId: target.parentId, index: Math.max(0, insertAt - movingBefore) }));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const ids = dragIdsRef.current;
    const overId = event.over?.id ? String(event.over.id) : null;
    const mergeWith =
      overId && overId.startsWith(ITEM_PREFIX) && dwell.target === overId.slice(ITEM_PREFIX.length)
        ? overId.slice(ITEM_PREFIX.length)
        : null;
    const side = indicator === 'after' ? 'after' : 'before';
    const pageTarget = overId?.startsWith(PAGE_PREFIX) ? Number(overId.slice(PAGE_PREFIX.length)) : null;
    resetDragState();

    if (!overId || ids.length === 0) return;

    if (mergeWith) {
      const before = store.getState();
      const target = itemById(before.items, mergeWith);
      const created = target?.type === 'bookmark';
      let folderId: string | null = null;
      store.mutate((s) => {
        const result = mergeIntoFolder(s, ids, mergeWith);
        folderId = result.folderId;
        return result.state;
      });
      const label = created ? 'Created folder' : 'Added to folder';
      store.toast(`${label} · ${ids.length} item${ids.length === 1 ? '' : 's'}`, {
        actionLabel: folderId ? 'Open' : undefined,
        action: folderId ? () => setOpenFolderId(folderId) : undefined,
      });
      return;
    }

    if (overId.startsWith(ITEM_PREFIX)) {
      applyMoveToPosition(ids, overId.slice(ITEM_PREFIX.length), side);
      return;
    }

    if (overId.startsWith(CONTAINER_PREFIX)) {
      // Works for `container:root` too — containerFromKey(null) === null.
      store.mutate((s) => moveItems(s, ids, { parentId: containerFromKey(overId) }));
      return;
    }

    if (pageTarget !== null) {
      const current = settingsRef.current;
      const perPage = Math.max(1, current.columnsIos * current.rowsIos);
      store.mutate((s) => moveItems(s, ids, { parentId: null, index: pageTarget * perPage }));
    }
  };

  /* ---------------- actions (identity-stable where tiles depend on them) -------- */

  const recordVisit = useCallback((id: string) => {
    // Not undoable: a visit is not an edit, and ⌘Z must not "un-visit" a page.
    store.mutate((s) => recordOpen(s, id), { undoable: false });
  }, []);

  const openItem = useCallback(
    (item: Item, newTab?: boolean) => {
      if (item.type === 'folder') {
        setOpenFolderId(item.id);
        setSelection([]);
        return;
      }
      if (!item.url) return;
      recordVisit(item.id);
      const target = newTab ?? settingsRef.current.openInNewTab;
      if (target) window.open(item.url, '_blank', 'noopener,noreferrer');
      else window.location.href = item.url;
    },
    [recordVisit],
  );

  const performDelete = useCallback((items: Item[]) => {
    const ids = items.map((i) => i.id);
    const snapshot = ids.flatMap((id) => [id, ...collectDescendants(store.getState().items, id)]);
    store.mutate((s) => deleteItems(s, ids));
    setSelection([]);
    store.toast(`Deleted ${items.length} item${items.length === 1 ? '' : 's'}`, {
      actionLabel: 'Undo',
      action: () => store.mutate((s) => restoreItems(s, snapshot)),
    });
  }, []);

  const deleteSelection = useCallback(
    (items: Item[]) => {
      if (!items.length) return;
      const snapshot = store.getState();
      const fullFolder = items.find((i) => i.type === 'folder' && childrenOf(snapshot.items, i.id).length > 0);
      if (fullFolder) {
        setConfirm({
          title: `Delete “${fullFolder.title}”?`,
          message: 'Everything nested inside it goes too. Nothing is sent anywhere, and you can undo this.',
          confirmLabel: 'Delete',
          destructive: true,
          onConfirm: () => performDelete(items),
        });
        return;
      }
      performDelete(items);
    },
    [performDelete],
  );

  const duplicateItems = useCallback((items: Item[]) => {
    store.mutate((s) => {
      const clone = (sourceId: string, parentId: string | null): Item[] => {
        const source = itemById(s.items, sourceId);
        if (!source) return [];
        const newId = uid();
        const copy: Item = {
          ...source,
          id: newId,
          parentId,
          order: childrenOf(s.items, parentId).length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const nested = childrenOf(s.items, sourceId).flatMap((child) => clone(child.id, newId));
        return [copy, ...nested];
      };
      const created = items.flatMap((item) => clone(item.id, item.parentId));
      return { ...s, items: [...s.items, ...created], updatedAt: Date.now() };
    });
    setSelection([]);
    store.toast(`Duplicated ${items.length} item${items.length === 1 ? '' : 's'}.`);
  }, []);

  const moveToContainer = useCallback((items: Item[], parentId: string | null, message: string) => {
    store.mutate((s) => moveItems(s, items.map((i) => i.id), { parentId }));
    setSelection([]);
    store.toast(message);
  }, []);

  const onSelect = useCallback((item: Item, additive: boolean) => {
    setSelection((current) => {
      if (!additive) return current.includes(item.id) && current.length === 1 ? [] : [item.id];
      return current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id];
    });
  }, []);

  const onTileContextMenu = useCallback((item: Item, x: number, y: number) => {
    if (!selectionRef.current.has(item.id)) setSelection([item.id]);
    setMenu({ item, x, y });
  }, []);

  const onRemoveBadge = useCallback(
    (item: Item) => {
      deleteSelection([item]);
    },
    [deleteSelection],
  );

  const newFolder = useCallback((parentId: string | null) => {
    store.mutate((s) => createFolder(s, { parentId }).state);
    store.toast('Folder created.');
  }, []);

  const contextActions: ContextMenuActions = {
    onOpen: (item, newTab) => openItem(item, newTab),
    onCopyLink: (item) => {
      if (!item.url) return;
      void navigator.clipboard
        .writeText(item.url)
        .then(() => store.toast('Link copied.'))
        .catch(() => store.toast('Clipboard permission denied.'));
    },
    onRename: (item) => setEditSheet({ mode: item.type, item }),
    onDuplicate: (item) => duplicateItems([item]),
    onDelete: (items) => deleteSelection(items),
    onNewFolderWith: (items) => {
      let folderId: string | null = null;
      store.mutate((s) => {
        const result = createFolder(s, { childIds: items.map((i) => i.id) });
        folderId = result.folder.id;
        return result.state;
      });
      setSelection([]);
      store.toast('Created folder.', {
        actionLabel: 'Open',
        action: () => folderId && setOpenFolderId(folderId),
      });
    },
    onUngroup: (item) => {
      store.mutate((s) => {
        const kids = childrenOf(s.items, item.id).map((k) => k.id);
        const moved = moveItems(s, kids, { parentId: item.parentId, index: item.order });
        return deleteItems(moved, [item.id]);
      });
      setOpenFolderId(null);
      store.toast('Folder dissolved.');
    },
    onMoveTo: (items, parentId) => moveToContainer(items, parentId, 'Moved.'),
    onAddToReadingList: (items) => moveToContainer(items, READING_ID, 'Added to Reading List.'),
    onAddToDock: (items) => moveToContainer(items, DOCK_ID, 'Added to the Dock.'),
    onRemoveFromContainer: (items) => moveToContainer(items, null, 'Returned to Favorites.'),
    onNewBookmark: () => setEditSheet({ mode: 'bookmark', parentId: openFolderId ?? null }),
    onNewFolder: () => newFolder(null),
    onCustomize: () => setCustomizeOpen(true),
    onExport: () => setImportOpen(true),
    onImport: () => setImportOpen(true),
  };

  /* ---------------- iOS paging ---------------- */
  const perPage = Math.max(1, settings.columnsIos * settings.rowsIos);
  const pages = useMemo(() => chunk(favorites, perPage), [favorites, perPage]);
  const pageIndex = Math.min(iosPage, Math.max(0, pages.length - 1));
  const pageRef = useRef({ index: pageIndex, count: pages.length });
  pageRef.current = { index: pageIndex, count: pages.length };

  const changePage = useCallback((page: number) => {
    setIosPage((current) => {
      const clamped = Math.max(0, page);
      setPageDirection(clamped >= current ? 1 : -1);
      return clamped;
    });
  }, []);

  const stepPage = useCallback(
    (delta: number) => {
      const { index, count } = pageRef.current;
      const next = Math.min(Math.max(index + delta, 0), Math.max(0, count - 1));
      if (next !== index) changePage(next);
    },
    [changePage],
  );

  /* ---------------- render helpers ---------------- */
  const renderTile = useCallback(
    (item: Item, visits?: number, overrides: Partial<{ labels: boolean }> = {}): ReactNode => (
      <Tile
        key={item.id}
        item={item}
        allItems={allItems}
        layout={settings.layout}
        labels={overrides.labels ?? settings.labels}
        jiggle={jiggle && settings.layout === 'ios'}
        selected={selectionSet.has(item.id)}
        isMergeTarget={mergeTargetId === item.id}
        indicator={activeId && overItemId === item.id && !mergeTargetId ? indicator : null}
        visits={visits}
        onOpen={openItem}
        onSelect={onSelect}
        onContextMenu={onTileContextMenu}
        onRemoveBadge={onRemoveBadge}
      />
    ),
    [
      allItems,
      settings.layout,
      settings.labels,
      jiggle,
      selectionSet,
      mergeTargetId,
      activeId,
      overItemId,
      indicator,
      openItem,
      onSelect,
      onTileContextMenu,
      onRemoveBadge,
    ],
  );

  /* ---------------- keyboard ---------------- */
  const handleKeyboard = useCallback(
    (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);

      if (event.key === 'Escape') {
        if (menu) return setMenu(null);
        if (sheet) return setSheet(null);
        if (openFolderId) return setOpenFolderId(null);
        if (customizeOpen) return setCustomizeOpen(false);
        if (jiggle) return setJiggle(false);
        if (selectionRef.current.size) return setSelection([]);
        return;
      }
      if (typing) return;

      if (meta && event.key === ',') {
        event.preventDefault();
        setCustomizeOpen((v) => !v);
        return;
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        setSheet((current) => (current === 'help' ? null : 'help'));
        return;
      }
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setEditSheet({ mode: event.shiftKey ? 'folder' : 'bookmark', parentId: openFolderId ?? null });
        return;
      }
      if (event.key === '/' && settingsRef.current.showSearch) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      const grid = activeGrid();
      if (!grid) return;
      const columns = gridColumns(grid);
      const tiles = tilesIn(grid);
      const count = tiles.length;
      const current = focusedTileIndex(grid);

      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const ids = Array.from(grid.querySelectorAll<HTMLElement>('.tile-slot[data-item-id]'))
          .map((node) => node.dataset.itemId)
          .filter((id): id is string => Boolean(id));
        setSelection(ids);
        return;
      }

      const direction = ARROW_DIRECTIONS[event.key];
      if (direction) {
        event.preventDefault();
        if (current < 0) {
          focusTile(grid, 0);
          return;
        }
        const next = nextIndex(current, direction, { columns, count });
        if (next !== null) {
          focusTile(grid, next);
          return;
        }
        // At an edge in the iOS layout, arrows flip pages — like the keyboard does
        // on a real iOS device with a hardware keyboard.
        if (settingsRef.current.layout === 'ios') {
          if (direction === 'right') {
            const { index, count: pageCount } = pageRef.current;
            if (index < pageCount - 1) {
              changePage(index + 1);
              window.setTimeout(() => focusTile(activeGrid(), 0), 60);
            }
          } else if (direction === 'left') {
            const { index } = pageRef.current;
            if (index > 0) {
              changePage(index - 1);
              window.setTimeout(() => {
                const target = tilesIn(activeGrid());
                focusTile(activeGrid(), target.length - 1);
              }, 60);
            }
          }
        }
        return;
      }

      if (event.key === ' ') {
        const focused = current >= 0 ? tiles[current] : null;
        const itemId = focused?.closest<HTMLElement>('.tile-slot[data-item-id]')?.dataset.itemId;
        if (itemId) {
          event.preventDefault();
          const item = itemById(stateRef.current.items, itemId);
          if (item) onSelect(item, true);
        }
        return;
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && selectionRef.current.size) {
        event.preventDefault();
        const items = [...selectionRef.current]
          .map((id) => itemById(stateRef.current.items, id))
          .filter((i): i is Item => Boolean(i));
        deleteSelection(items);
      }
    },
    [menu, sheet, openFolderId, customizeOpen, jiggle, deleteSelection, onSelect, changePage],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [handleKeyboard]);

  /* ---------------- iOS wheel paging ---------------- */
  const wheelLock = useRef(0);
  const onIosWheel = useCallback(
    (event: React.WheelEvent) => {
      const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
      if (Math.abs(dominant) < 18) return;
      const now = Date.now();
      if (now < wheelLock.current) return;
      wheelLock.current = now + PAGE_WHEEL_LOCK_MS;
      stepPage(dominant > 0 ? 1 : -1);
    },
    [stepPage],
  );

  /* ---------------- render ---------------- */
  const showIos = settings.layout === 'ios';

  const dragGhost = activeItem ? (
    <div className="relative">
      <div className="drag-ghost">
        <GhostIcon item={activeItem} allItems={allItems} size={settings.layout === 'macos' ? 76 : 62} />
      </div>
      {dragIds.length > 1 && (
        <span className="merge-badge" style={{ inset: 'auto 0 74px' }}>
          <span>{dragIds.length} items</span>
        </span>
      )}
    </div>
  ) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDragState}
    >
      <div
        className="startpage"
        onContextMenu={(event) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          setMenu({ item: null, x: event.clientX, y: event.clientY });
        }}
      >
        <div
          className="wallpaper"
          // `background` shorthand resets background-color, so re-declare it after.
          style={{ background: wallpaper.css, backgroundColor: '#101014' }}
          aria-hidden
        />
        {settings.wallpaperMotion && <div className="wallpaper-drift" aria-hidden />}
        {settings.ambient && (
          <>
            <div className="wallpaper-vignette" aria-hidden />
            <div className="wallpaper-grain" aria-hidden />
          </>
        )}
        <div className="wallpaper-dim" aria-hidden />

        <div
          className="startpage-content"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelection([]);
          }}
        >
          {settings.showSearch && (
            <div className="mb-7">
              <SearchField engine={settings.searchEngine} state={state} onOpenItem={openItem} inputRef={searchRef} />
            </div>
          )}

          <Toolbar
            connected={connected}
            canUndo={canUndo}
            canRedo={canRedo}
            jiggle={jiggle}
            layout={settings.layout}
            onUndo={() => store.undo()}
            onRedo={() => store.redo()}
            onAddBookmark={() => setEditSheet({ mode: 'bookmark', parentId: openFolderId ?? null })}
            onAddFolder={() => newFolder(null)}
            onImportExport={() => setImportOpen(true)}
            onToggleJiggle={() => setJiggle((v) => !v)}
            onSync={() => requestBridgeSync()}
            onLayoutChange={(layout) => store.mutate((s) => ({ ...s, settings: { ...s.settings, layout }, settingsUpdatedAt: Date.now() }))}
            onOpenHelp={() => setSheet('help')}
            onCustomize={() => setCustomizeOpen((v) => !v)}
          />

          {showIos ? (
            <IosHome
              pages={pages}
              pageIndex={pageIndex}
              direction={pageDirection}
              perPage={perPage}
              columns={settings.columnsIos}
              renderTile={renderTile}
              labels={settings.labels}
              onPageChange={changePage}
              onWheel={onIosWheel}
              onAddBookmark={() => setEditSheet({ mode: 'bookmark', parentId: null })}
              onAddFolder={() => newFolder(null)}
              onLongPress={() => setJiggle(true)}
            />
          ) : (
            <>
              {settings.showFavorites && (
                <FavoritesSection
                  title={settings.favoritesTitle}
                  items={favorites}
                  columns={settings.columnsMac}
                  renderTile={renderTile}
                  onAddBookmark={() => setEditSheet({ mode: 'bookmark', parentId: null })}
                  onAddFolder={() => newFolder(null)}
                  layout={settings.layout}
                />
              )}

              {settings.showFrequentlyVisited && (
                <FrequentlyVisited
                  state={state}
                  limit={Math.max(4, settings.columnsMac)}
                  title={settings.frequentTitle}
                  renderTile={(item, visits) => renderTile(item, visits)}
                  onClear={() => {
                    store.mutate((s) => clearStats(s));
                    store.toast('Visit history cleared.');
                  }}
                />
              )}

              {settings.showPrivacyReport && <PrivacyReport state={state} />}

              {settings.showReadingList && (
                <ReadingList
                  items={readingItems}
                  onOpen={openItem}
                  onContextMenu={onTileContextMenu}
                  onRemove={(item) => moveToContainer([item], null, 'Returned to Favorites.')}
                />
              )}
            </>
          )}
        </div>

        {showIos && settings.showDock && (
          <Dock
            items={dockItems}
            renderTile={(item) => renderTile(item, undefined, { labels: false })}
            onAdd={() => setEditSheet({ mode: 'bookmark', parentId: DOCK_ID })}
          />
        )}

        <button
          type="button"
          className="icon-btn customize-fab"
          aria-label="Customize start page"
          title="Customize (⌘,)"
          onClick={() => setCustomizeOpen((v) => !v)}
        >
          <SlidersGlyph />
        </button>

        <CustomizePanel
          open={customizeOpen}
          onClose={() => setCustomizeOpen(false)}
          onImportExport={() => setImportOpen(true)}
          onOpenHelp={() => setSheet('help')}
          customUrls={customUrls}
        />
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }}>
        {dragGhost}
      </DragOverlay>

      <AnimatePresence>
        {openFolder && (
          <FolderOverlay
            key={openFolder.id}
            folder={openFolder}
            state={state}
            renderTile={(item) => renderTile(item)}
            onClose={() => setOpenFolderId(null)}
            onNewBookmark={() => setEditSheet({ mode: 'bookmark', parentId: openFolder.id })}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && (
          <HelpSheet
            key={sheet}
            variant={sheet}
            onClose={() => {
              // Closing the first-run tips by any route counts as "seen" — nobody
              // wants them back on every load.
              if (sheet === 'tips') markTipsSeen();
              setSheet(null);
            }}
            onDismissTips={markTipsSeen}
          />
        )}
      </AnimatePresence>

      {menu && (
        <ContextMenu
          target={menu}
          selection={selectedItems}
          items={allItems}
          actions={contextActions}
          onClose={() => setMenu(null)}
        />
      )}

      <SelectionBar
        items={selectedItems}
        onNewFolder={() => contextActions.onNewFolderWith(selectedItems)}
        onReadingList={() => contextActions.onAddToReadingList(selectedItems)}
        onDock={() => contextActions.onAddToDock(selectedItems)}
        onDuplicate={() => duplicateItems(selectedItems)}
        onDelete={() => deleteSelection(selectedItems)}
        onClear={() => setSelection([])}
      />

      {editSheet && <EditSheet state={editSheet} onClose={() => setEditSheet(null)} />}
      {confirm && <ConfirmSheet state={confirm} onClose={() => setConfirm(null)} />}
      {importOpen && (
        <ImportExportSheet
          appState={state}
          onClose={() => setImportOpen(false)}
          onImportState={(next: StoreState) => {
            store.replace(next, { broadcast: true, undoable: true });
            store.toast('Import merged into your start page.', {
              actionLabel: 'Undo',
              action: () => store.undo(),
            });
          }}
        />
      )}

      <Toasts toasts={toasts} onDismiss={store.dismissToast} />
    </DndContext>
  );
}

/* ------------------------------------------------------------------ */
/* macOS Safari start page layout                                      */
/* ------------------------------------------------------------------ */

function FavoritesSection({
  title,
  items,
  columns,
  renderTile,
  onAddBookmark,
  onAddFolder,
  layout,
}: {
  title: string;
  items: Item[];
  columns: number;
  renderTile: (item: Item) => ReactNode;
  onAddBookmark: () => void;
  onAddFolder: () => void;
  layout: 'macos' | 'ios';
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { setNodeRef, isOver } = useDroppable({ id: containerKey(null), data: { containerId: null } });
  const effectiveColumns = useMemo(() => {
    const tile = layout === 'macos' ? 76 : 62;
    const gutter = 10;
    const fitting = Math.max(2, Math.floor((width + gutter) / (tile + gutter)));
    return Math.max(2, Math.min(columns, fitting || columns));
  }, [columns, layout, width]);

  return (
    <section className="section" aria-label="Favorites">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <button type="button" className="section-action" onClick={onAddBookmark}>
          + Add
        </button>
      </div>
      <div
        ref={(node) => {
          setNodeRef(node);
          ref.current = node;
        }}
        data-grid
        role="group"
        aria-label={`${title} grid`}
        className={`icon-grid dropzone ${isOver ? 'is-over' : ''}`}
        style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, var(--tile)))`, justifyContent: 'start' }}
      >
        {items.map((item) => renderTile(item))}
        {items.length === 0 && (
          <div className="empty-card" style={{ gridColumn: `1 / span ${Math.min(effectiveColumns, 4)}` }}>
            <span className="glyph" aria-hidden>
              ★
            </span>
            <div>
              <strong>No favorites yet</strong>
              <p>
                Drop a link here, press <kbd>⌘N</kbd>, or save a tab with the extension (<kbd>⌘⇧S</kbd>).
              </p>
            </div>
          </div>
        )}
        <AddTile onAddBookmark={onAddBookmark} onAddFolder={onAddFolder} layout={layout} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* iOS home screen layout                                              */
/* ------------------------------------------------------------------ */

function IosHome({
  pages,
  pageIndex,
  direction,
  perPage,
  columns,
  renderTile,
  labels,
  onPageChange,
  onWheel,
  onAddBookmark,
  onAddFolder,
  onLongPress,
}: {
  pages: Item[][];
  pageIndex: number;
  direction: number;
  perPage: number;
  columns: number;
  renderTile: (item: Item) => ReactNode;
  labels: boolean;
  onPageChange: (page: number) => void;
  onWheel: (event: React.WheelEvent) => void;
  onAddBookmark: () => void;
  onAddFolder: () => void;
  onLongPress: () => void;
}) {
  const page = pages[pageIndex] ?? [];
  const longPress = useLongPress(onLongPress, 520);
  const { setNodeRef, isOver } = useDroppable({ id: containerKey(null), data: { containerId: null } });
  const isLastPage = pageIndex === pages.length - 1;

  return (
    <section className="section flex-1 flex flex-col" aria-label="Home screen">
      <div
        ref={setNodeRef}
        className={`dropzone ios-page flex-1 ${isOver ? 'is-over' : ''}`}
        onWheel={onWheel}
        onPointerDown={longPress.onPointerDown}
        onPointerMove={longPress.onPointerMove}
        onPointerUp={longPress.onPointerUp}
        onPointerLeave={longPress.onPointerLeave}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pageIndex}
            data-grid
            role="group"
            aria-label={`Home screen page ${pageIndex + 1}`}
            className="icon-grid"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, var(--tile)))`, justifyContent: 'center' }}
            initial={{ opacity: 0, x: direction * 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -48 }}
            transition={{ type: 'spring', stiffness: 460, damping: 40 }}
          >
            {page.map((item) => renderTile(item))}
            {isLastPage && <AddTile onAddBookmark={onAddBookmark} onAddFolder={onAddFolder} layout="ios" />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex justify-center py-4">
        <PageDots count={pages.length} index={pageIndex} onChange={onPageChange} perPage={perPage} labels={labels} />
      </div>
    </section>
  );
}

function PageDots({
  count,
  index,
  onChange,
  perPage,
  labels,
}: {
  count: number;
  index: number;
  onChange: (page: number) => void;
  perPage: number;
  labels: boolean;
}) {
  return (
    <div className="page-dots" role="tablist" aria-label="Home screen pages">
      {Array.from({ length: count }).map((_, page) => (
        <PageDot
          key={page}
          page={page}
          active={page === index}
          perPage={perPage}
          labels={labels}
          onSelect={() => onChange(page)}
        />
      ))}
    </div>
  );
}

function PageDot({
  page,
  active,
  perPage,
  labels,
  onSelect,
}: {
  page: number;
  active: boolean;
  perPage: number;
  labels: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${PAGE_PREFIX}${page}`, data: { page } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`page-dot ${active ? 'active' : ''} ${isOver ? 'is-over' : ''}`}
      aria-selected={active}
      role="tab"
      title={labels ? `Page ${page + 1} — drop here to move to this page` : `Page ${page + 1}`}
      aria-label={`Page ${page + 1} (holds up to ${perPage} icons)`}
      onClick={onSelect}
    />
  );
}

/* ------------------------------------------------------------------ */
/* iOS dock                                                            */
/* ------------------------------------------------------------------ */

function Dock({
  items,
  renderTile,
  onAdd,
}: {
  items: Item[];
  renderTile: (item: Item) => ReactNode;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: containerKey(DOCK_ID), data: { containerId: DOCK_ID } });
  const longPress = useLongPress(() => undefined, 600);
  return (
    <div className="dock-wrap" onPointerDown={longPress.onPointerDown} onPointerUp={longPress.onPointerUp}>
      <div ref={setNodeRef} className={`dock ${isOver ? 'is-over' : ''}`}>
        {items.map((item) => renderTile(item))}
        {items.length === 0 && (
          <div className="hint" style={{ maxWidth: 260, textAlign: 'center' }}>
            Drag favorites here to keep them in the Dock.{' '}
            <button type="button" className="btn btn-ghost" onClick={onAdd}>
              Add one
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
