import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
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
  collectDescendants,
  createFolder,
  deleteItems,
  itemById,
  liveItems,
  mergeIntoFolder,
  moveItems,
  resolveWallpaper,
  requestBridgeSync,
  restoreItems,
  uid,
} from '@safari/shared';
import { store } from '../state/store';
import {
  useChildren,
  useDwell,
  useElementWidth,
  useSettings,
  useStartPage,
  useSystemTheme,
} from '../state/hooks';
import { useLongPress, useWallpaperUrls } from '../lib/hooks-lib';
import { Indicator, AddTile, GhostIcon, Tile } from './Tiles';
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
import { PrivacyReport, ReadingList, SearchField, StatusPill, Toasts } from './Panels';

const MERGE_DWELL_MS = 420;
const ITEM_PREFIX = 'item:';
const CONTAINER_PREFIX = 'container:';
const PAGE_PREFIX = 'page:';

const containerKey = (parentId: string | null): string => `${CONTAINER_PREFIX}${parentId ?? 'root'}`;
const containerFromKey = (key: string): string | null => {
  const raw = key.slice(CONTAINER_PREFIX.length);
  return raw === 'root' ? null : raw;
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

function chunk<T>(list: T[], size: number): T[][] {
  if (size <= 0) return [list];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}

export function StartPage() {
  const { state, connected, canUndo, canRedo, toasts } = useStartPage();
  const settings = useSettings();
  const systemTheme = useSystemTheme();
  const scheme = settings.theme === 'system' ? systemTheme : settings.theme;

  /* ---------------- wallpaper + theme tokens ---------------- */
  const customUrls = useWallpaperUrls(settings.wallpapers.map((w) => w.id));
  const wallpaper = useMemo(() => resolveWallpaper(settings.wallpaper, customUrls), [settings.wallpaper, customUrls]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.scheme = scheme;
    root.dataset.iconStyle = settings.iconStyle;
    root.classList.toggle('icon-dark', settings.iconStyle === 'dark');
    root.classList.toggle('icon-tinted', settings.iconStyle === 'tinted');
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
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [editSheet, setEditSheet] = useState<EditSheetState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [jiggle, setJiggle] = useState(false);
  const [iosPage, setIosPage] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const openFolder = openFolderId ? itemById(state.items, openFolderId) ?? null : null;
  const selectedItems = selection.map((id) => itemById(state.items, id)).filter((i): i is Item => Boolean(i));

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
    const item = itemById(state.items, itemId);
    if (!item) return;
    const group = (selection.includes(itemId) ? selection : [itemId])
      .map((id) => itemById(state.items, id))
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
        window.setTimeout(() => setIosPage(page), MERGE_DWELL_MS);
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
    const mergeWith = overId && overId.startsWith(ITEM_PREFIX) && dwell.target === overId.slice(ITEM_PREFIX.length)
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
      const perPage = Math.max(1, settings.columnsIos * settings.rowsIos);
      store.mutate((s) => moveItems(s, ids, { parentId: null, index: pageTarget * perPage }));
    }
  };

  /* ---------------- actions ---------------- */
  const openItem = useCallback(
    (item: Item, newTab?: boolean) => {
      if (item.type === 'folder') {
        setOpenFolderId(item.id);
        setSelection([]);
        return;
      }
      const target = newTab ?? settings.openInNewTab;
      if (!item.url) return;
      if (target) window.open(item.url, '_blank', 'noopener,noreferrer');
      else window.location.href = item.url;
    },
    [settings.openInNewTab],
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
    onDuplicate: (item) => {
      store.mutate((s) => {
        const clone = (sourceId: string, parentId: string | null): { items: Item[]; rootId: string } => {
          const source = itemById(s.items, sourceId);
          if (!source) return { items: [], rootId: '' };
          const newId = uid();
          const copy: Item = {
            ...source,
            id: newId,
            parentId,
            title: source.title,
            order: childrenOf(s.items, parentId).length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const nested = childrenOf(s.items, sourceId).flatMap((child) => clone(child.id, newId).items);
          return { items: [copy, ...nested], rootId: newId };
        };
        const created = clone(item.id, item.parentId);
        return { ...s, items: [...s.items, ...created.items], updatedAt: Date.now() };
      });
      store.toast('Duplicated.');
    },
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
    onMoveTo: (items, parentId) => {
      store.mutate((s) => moveItems(s, items.map((i) => i.id), { parentId }));
      setSelection([]);
    },
    onAddToReadingList: (items) => {
      store.mutate((s) => moveItems(s, items.map((i) => i.id), { parentId: READING_ID }));
      store.toast(`Added to Reading List.`);
    },
    onAddToDock: (items) => {
      store.mutate((s) => moveItems(s, items.map((i) => i.id), { parentId: DOCK_ID }));
      store.toast(`Added to Dock.`, { actionLabel: undefined });
    },
    onRemoveFromContainer: (items) => {
      store.mutate((s) => moveItems(s, items.map((i) => i.id), { parentId: null }));
    },
    onNewBookmark: () => setEditSheet({ mode: 'bookmark', parentId: null }),
    onNewFolder: () => {
      store.mutate((s) => createFolder(s, { parentId: null }).state);
      store.toast('Folder created.');
    },
    onCustomize: () => setCustomizeOpen(true),
    onExport: () => setImportOpen(true),
    onImport: () => setImportOpen(true),
  };

  const onSelect = (item: Item, additive: boolean) => {
    setSelection((current) => {
      if (!additive) return current.includes(item.id) && current.length === 1 ? [] : [item.id];
      return current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id];
    });
  };

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);

      if (event.key === 'Escape') {
        if (menu) return setMenu(null);
        if (openFolderId) return setOpenFolderId(null);
        if (customizeOpen) return setCustomizeOpen(false);
        if (jiggle) return setJiggle(false);
        if (selection.length) return setSelection([]);
        return;
      }
      if (typing) return;

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
      if (event.key === '/' && settings.showSearch) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedItems.length) {
        event.preventDefault();
        deleteSelection(selectedItems);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, openFolderId, customizeOpen, jiggle, selection, selectedItems, settings.showSearch, deleteSelection]);

  /* ---------------- render helpers ---------------- */
  const renderTile = useCallback(
    (item: Item, overrides: Partial<{ labels: boolean }> = {}): ReactNode => (
      <Tile
        key={item.id}
        item={item}
        allItems={allItems}
        layout={settings.layout}
        labels={overrides.labels ?? settings.labels}
        jiggle={jiggle && settings.layout === 'ios'}
        selected={selection.includes(item.id)}
        isMergeTarget={mergeTargetId === item.id}
        indicator={activeId && overItemId === item.id && !mergeTargetId ? indicator : null}
        onOpen={openItem}
        onSelect={onSelect}
        onContextMenu={(subject, x, y) => {
          if (!selection.includes(subject.id)) setSelection([subject.id]);
          setMenu({ item: subject, x, y });
        }}
        onRemoveBadge={(subject) => deleteSelection([subject])}
      />
    ),
    [
      allItems,
      settings.layout,
      settings.labels,
      jiggle,
      selection,
      mergeTargetId,
      activeId,
      overItemId,
      indicator,
      openItem,
      deleteSelection,
    ],
  );

  const perPage = Math.max(1, settings.columnsIos * settings.rowsIos);
  const pages = useMemo(() => chunk(favorites, perPage), [favorites, perPage]);
  const pageIndex = Math.min(iosPage, Math.max(0, pages.length - 1));

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

  const showIos = settings.layout === 'ios';

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDragState}
    >
      <div className="startpage" onContextMenu={(event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        setMenu({ item: null, x: event.clientX, y: event.clientY });
      }}>
        <div
          className="wallpaper"
          // `background` shorthand resets background-color, so re-declare it after.
          style={{ background: wallpaper.css, backgroundColor: '#101014' }}
          aria-hidden
        />
        <div className="wallpaper-dim" aria-hidden />

        <div className="startpage-content" onClick={(event) => {
          if (event.target === event.currentTarget) setSelection([]);
        }}>
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
            showIos={showIos}
            onUndo={() => store.undo()}
            onRedo={() => store.redo()}
            onAddBookmark={() => setEditSheet({ mode: 'bookmark', parentId: openFolderId ?? null })}
            onAddFolder={() => {
              store.mutate((s) => createFolder(s, { parentId: openFolderId ?? null }).state);
              store.toast('Folder created.');
            }}
            onImportExport={() => setImportOpen(true)}
            onToggleJiggle={() => setJiggle((v) => !v)}
            onSync={() => requestBridgeSync()}
            onDoneJiggle={() => setJiggle(false)}
          />

          {showIos ? (
            <IosHome
              pages={pages}
              pageIndex={pageIndex}
              perPage={perPage}
              columns={settings.columnsIos}
              renderTile={renderTile}
              labels={settings.labels}
              onPageChange={(page) => setIosPage(page)}
              onAddBookmark={() => setEditSheet({ mode: 'bookmark', parentId: null })}
              onAddFolder={() => {
                store.mutate((s) => createFolder(s, { parentId: null }).state);
                store.toast('Folder created.');
              }}
              onLongPress={() => setJiggle(true)}
            />
          ) : (
            <FavoritesSection
              title={settings.favoritesTitle}
              items={favorites}
              columns={settings.columnsMac}
              renderTile={renderTile}
              show={settings.showFavorites}
              onAddBookmark={() => setEditSheet({ mode: 'bookmark', parentId: null })}
              onAddFolder={() => {
                store.mutate((s) => createFolder(s, { parentId: null }).state);
                store.toast('Folder created.');
              }}
              layout={settings.layout}
            />
          )}

          {!showIos && settings.showReadingList && (
            <ReadingList items={readingItems} onOpen={openItem} onContextMenu={(item, x, y) => {
              setSelection([item.id]);
              setMenu({ item, x, y });
            }} />
          )}
          {!showIos && settings.showPrivacyReport && <PrivacyReport state={state} />}
        </div>

        {showIos && settings.showDock && (
          <Dock items={dockItems} renderTile={(item) => renderTile(item, { labels: false })} onAdd={() => setEditSheet({ mode: 'bookmark', parentId: DOCK_ID })} />
        )}

        <button
          type="button"
          className="icon-btn customize-fab"
          aria-label="Customize start page"
          title="Customize"
          onClick={() => setCustomizeOpen((v) => !v)}
        >
          <SlidersGlyph />
        </button>

        <CustomizePanel
          open={customizeOpen}
          onClose={() => setCustomizeOpen(false)}
          onImportExport={() => setImportOpen(true)}
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
            renderTile={renderTile}
            onClose={() => setOpenFolderId(null)}
            onNewBookmark={() => setEditSheet({ mode: 'bookmark', parentId: openFolder.id })}
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
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */

function Toolbar({
  connected,
  canUndo,
  canRedo,
  jiggle,
  showIos,
  onUndo,
  onRedo,
  onAddBookmark,
  onAddFolder,
  onImportExport,
  onToggleJiggle,
  onSync,
  onDoneJiggle,
}: {
  connected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  jiggle: boolean;
  showIos: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddBookmark: () => void;
  onAddFolder: () => void;
  onImportExport: () => void;
  onToggleJiggle: () => void;
  onSync: () => void;
  onDoneJiggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <StatusPill connected={connected} onSync={onSync} />
      <div className="flex items-center gap-2">
        {jiggle && showIos && (
          <button type="button" className="btn btn-primary" onClick={onDoneJiggle}>
            Done
          </button>
        )}
        {showIos && !jiggle && (
          <button type="button" className="btn" onClick={onToggleJiggle}>
            Edit Layout
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo} style={!canUndo ? { opacity: 0.4 } : undefined}>
          ↺
        </button>
        <button type="button" className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo} style={!canRedo ? { opacity: 0.4 } : undefined}>
          ↻
        </button>
        <button type="button" className="btn" onClick={onAddBookmark} title="New bookmark (⌘N)">
          + Bookmark
        </button>
        <button type="button" className="btn" onClick={onAddFolder} title="New folder (⇧⌘N)">
          + Folder
        </button>
        <button type="button" className="btn" onClick={onImportExport}>
          Import / Export
        </button>
      </div>
    </div>
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
  show,
  onAddBookmark,
  onAddFolder,
  layout,
}: {
  title: string;
  items: Item[];
  columns: number;
  renderTile: (item: Item) => ReactNode;
  show: boolean;
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

  if (!show) {
    return <>{items.length > 0 && <div className="hint mb-6">Favorites are hidden — turn them back on in Customize.</div>}</>;
  }

  return (
    <section className="section" aria-label="Favorites">
      <h2 className="section-title">{title}</h2>
      <div
        ref={(node) => {
          setNodeRef(node);
          ref.current = node;
        }}
        className={`icon-grid dropzone ${isOver ? 'is-over' : ''}`}
        style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, var(--tile)))`, justifyContent: 'start' }}
      >
        {items.map((item) => renderTile(item))}
        {items.length === 0 && (
          <div className="section-empty" style={{ gridColumn: `span ${Math.min(effectiveColumns, 4)}` }}>
            No favorites yet — drop a link here, press <kbd>⌘N</kbd>, or use the extension to save a tab.
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
  perPage,
  columns,
  renderTile,
  labels,
  onPageChange,
  onAddBookmark,
  onAddFolder,
  onLongPress,
}: {
  pages: Item[][];
  pageIndex: number;
  perPage: number;
  columns: number;
  renderTile: (item: Item) => ReactNode;
  labels: boolean;
  onPageChange: (page: number) => void;
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
        className={`icon-grid dropzone flex-1 content-start ${isOver ? 'is-over' : ''}`}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, var(--tile)))`, justifyContent: 'center' }}
        onPointerDown={longPress.onPointerDown}
        onPointerMove={longPress.onPointerMove}
        onPointerUp={longPress.onPointerUp}
        onPointerLeave={longPress.onPointerLeave}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {page.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            >
              {renderTile(item)}
            </motion.div>
          ))}
        </AnimatePresence>
        {isLastPage && (
          <AddTile onAddBookmark={onAddBookmark} onAddFolder={onAddFolder} layout="ios" />
        )}
      </div>

      <div className="flex justify-center py-4">
        <PageDots
          count={pages.length}
          index={pageIndex}
          onChange={onPageChange}
          perPage={perPage}
          labels={labels}
        />
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
      title={
        labels ? `Page ${page + 1} — drop here to move to this page` : `Page ${page + 1}`
      }
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
            Drag favorites here to keep them in the Dock. <button type="button" className="btn btn-ghost" onClick={onAdd}>Add one</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SlidersGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" strokeLinecap="round" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="10" cy="17" r="2.2" />
    </svg>
  );
}
