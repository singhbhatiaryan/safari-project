import { useEffect, useMemo, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { motion } from 'motion/react';
import { Item, StoreState, childrenOf, liveItems } from '@safari/shared';
import { store } from '../state/store';

/**
 * The iOS/macOS "open folder" window. It renders the *same* Tile components as the
 * grid, so dragging inside, dragging out (drop on the backdrop = Favorites) and
 * merging two icons inside a folder all work with no extra drag code.
 */
export function FolderOverlay({
  folder,
  state,
  renderTile,
  onClose,
  onNewBookmark,
}: {
  folder: Item;
  state: StoreState;
  renderTile: (item: Item) => ReactNode;
  onClose: () => void;
  onNewBookmark: () => void;
}) {
  const children = useMemo(() => childrenOf(state.items, folder.id), [state.items, folder.id]);
  const nestedCount = useMemo(
    () => liveItems(state.items).filter((i) => children.some((c) => c.id === i.parentId)).length,
    [state.items, children],
  );
  // The backdrop pops items back out to Favorites; the window itself appends
  // into the folder, so an accidental drop between icons does the sane thing.
  const { setNodeRef: setBackdropRef } = useDroppable({ id: 'container:root', data: { containerId: null } });
  const { setNodeRef: setWindowRef, isOver: windowIsOver } = useDroppable({
    id: `container:${folder.id}`,
    data: { containerId: folder.id },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rename = (title: string) => {
    store.mutate(
      (s) => ({
        ...s,
        items: s.items.map((i) => (i.id === folder.id ? { ...i, title, updatedAt: Date.now() } : i)),
        updatedAt: Date.now(),
      }),
      { coalesceKey: `rename:${folder.id}` },
    );
  };

  return (
    <div className="scrim" ref={setBackdropRef} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.div
        ref={setWindowRef}
        className={`folder-window glass-strong ${windowIsOver ? 'is-over' : ''}`}
        initial={{ scale: 0.82, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.86, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={`Folder ${folder.title}`}
      >
        <div className="flex flex-col items-center gap-1">
          <input
            className="folder-title-input"
            value={folder.title}
            aria-label="Folder name"
            onChange={(event) => rename(event.target.value)}
          />
          <span className="hint">
            {children.length} item{children.length === 1 ? '' : 's'}
            {nestedCount > 0 ? ` · ${nestedCount} in subfolders` : ''}
          </span>
        </div>

        <div className="folder-grid mt-4">
          {children.map((child) => (
            <div key={child.id}>{renderTile(child)}</div>
          ))}
          <button type="button" className="folder-inner-tile" onClick={onNewBookmark} aria-label="Add to folder">
            <span className="tile tile-dashed" style={{ width: 62, height: 62, clipPath: undefined }}>
              <span className="tile-glyph">+</span>
            </span>
            <span className="tile-label">Add</span>
          </button>
        </div>

        <div className="sheet-actions" style={{ justifyContent: 'space-between' }}>
          <span className="hint" style={{ maxWidth: 240, textAlign: 'left' }}>
            Drag icons onto each other to nest a folder, or onto the backdrop to pop them out.
          </span>
          <span className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Done
            </button>
          </span>
        </div>
      </motion.div>
    </div>
  );
}
