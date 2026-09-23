import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Item, folderTree } from '@safari/shared';

export interface MenuTarget {
  item: Item | null;
  x: number;
  y: number;
}

export interface ContextMenuActions {
  onOpen: (item: Item, newTab: boolean) => void;
  onCopyLink: (item: Item) => void;
  onRename: (item: Item) => void;
  onDuplicate: (item: Item) => void;
  onDelete: (items: Item[]) => void;
  onNewFolderWith: (items: Item[]) => void;
  onUngroup: (item: Item) => void;
  onMoveTo: (items: Item[], parentId: string | null) => void;
  onAddToReadingList: (items: Item[]) => void;
  onAddToDock: (items: Item[]) => void;
  onRemoveFromContainer: (items: Item[]) => void;
  onNewBookmark: () => void;
  onNewFolder: () => void;
  onCustomize: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function ContextMenu({
  target,
  selection,
  items,
  actions,
  onClose,
}: {
  target: MenuTarget;
  selection: Item[];
  items: Item[];
  actions: ContextMenuActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: target.x, y: target.y });
  const [submenuOpen, setSubmenuOpen] = useState(false);

  const subject = target.item ? selection.filter((i) => i.id !== target.item!.id) : [];
  const targets = target.item ? [target.item, ...subject] : [];
  const inVirtual = target.item ? target.item.parentId === '__dock__' || target.item.parentId === '__reading__' : false;
  const folders = folderTree(items);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = Math.min(target.x, window.innerWidth - rect.width - 12);
    const y = Math.min(target.y, window.innerHeight - rect.height - 12);
    setPos({ x: Math.max(12, x), y: Math.max(12, y) });
  }, [target.x, target.y, items.length]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  if (!target.item) {
    return (
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
        <button type="button" className="menu-item" onClick={run(actions.onNewBookmark)}>
          New Bookmark<span className="shortcut">⌘N</span>
        </button>
        <button type="button" className="menu-item" onClick={run(actions.onNewFolder)}>
          New Folder<span className="shortcut">⇧⌘N</span>
        </button>
        <div className="menu-sep" />
        <button type="button" className="menu-item" onClick={run(actions.onCustomize)}>
          Edit Wallpaper &amp; Theme…
        </button>
        <div className="menu-sep" />
        <button type="button" className="menu-item" onClick={run(actions.onImport)}>
          Import Bookmarks…
        </button>
        <button type="button" className="menu-item" onClick={run(actions.onExport)}>
          Export…
        </button>
      </div>
    );
  }

  const item = target.item;
  const many = targets.length > 1;

  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {item.type === 'bookmark' ? (
        <>
          <button type="button" className="menu-item" onClick={run(() => actions.onOpen(item, false))}>
            Open<span className="shortcut">↵</span>
          </button>
          <button type="button" className="menu-item" onClick={run(() => actions.onOpen(item, true))}>
            Open in New Tab<span className="shortcut">⌘↵</span>
          </button>
          <button type="button" className="menu-item" onClick={run(() => actions.onCopyLink(item))}>
            Copy Link
          </button>
        </>
      ) : (
        <button type="button" className="menu-item" onClick={run(() => actions.onOpen(item, false))}>
          Open Folder
        </button>
      )}

      <div className="menu-sep" />
      <button type="button" className="menu-item" onClick={run(() => actions.onRename(item))}>
        Rename…
      </button>
      <button type="button" className="menu-item" onClick={run(() => actions.onDuplicate(item))}>
        Duplicate
      </button>

      <div className="menu-sep" />
      {item.type === 'bookmark' && (
        <button type="button" className="menu-item" onClick={run(() => actions.onAddToReadingList(targets))}>
          Add to Reading List
        </button>
      )}
      <button type="button" className="menu-item" onClick={run(() => actions.onAddToDock(targets))}>
        Add to Dock
      </button>
      <div
        className="relative"
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <button type="button" className="menu-item" aria-haspopup="menu">
          Move to
          <span className="shortcut">▸</span>
        </button>
        {submenuOpen && (
          <div className="menu" style={{ position: 'absolute', left: '100%', top: -5, marginLeft: 2, maxHeight: 320, overflowY: 'auto' }}>
            <button type="button" className="menu-item" onClick={run(() => actions.onMoveTo(targets, null))}>
              Favorites
            </button>
            {folders.map(({ item: folder, depth }) => (
              <button
                key={folder.id}
                type="button"
                className="menu-item"
                style={{ paddingLeft: 9 + depth * 14 }}
                disabled={item.type === 'folder' && folder.id === item.id}
                onClick={run(() => actions.onMoveTo(targets, folder.id))}
              >
                {folder.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {many && (
        <button type="button" className="menu-item" onClick={run(() => actions.onNewFolderWith(targets))}>
          New Folder with {targets.length} Items
        </button>
      )}
      {item.type === 'folder' && (
        <button type="button" className="menu-item" onClick={run(() => actions.onUngroup(item))}>
          Dissolve Folder
        </button>
      )}
      {inVirtual && (
        <button type="button" className="menu-item" onClick={run(() => actions.onRemoveFromContainer(targets))}>
          Remove from {item.parentId === '__dock__' ? 'Dock' : 'Reading List'}
        </button>
      )}

      <div className="menu-sep" />
      <button type="button" className="menu-item destructive" onClick={run(() => actions.onDelete(targets))}>
        {many ? `Delete ${targets.length} Items` : 'Delete'}
      </button>
    </div>
  );
}
