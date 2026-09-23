import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { motion } from 'motion/react';
import { Item, StoreState, childrenOf, itemById, liveItems } from '@safari/shared';
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
  // Nested folders open *inside* the window (macOS behaviour) with a breadcrumb back.
  const [trail, setTrail] = useState<string[]>([]);
  const currentId = trail.length ? trail[trail.length - 1] : folder.id;

  useEffect(() => setTrail([]), [folder.id]);

  const current = useMemo(
    () => (currentId === folder.id ? folder : itemById(state.items, currentId)),
    [currentId, folder, state.items],
  );
  const children = useMemo(() => childrenOf(state.items, currentId), [state.items, currentId]);
  const nestedCount = useMemo(
    () => liveItems(state.items).filter((i) => children.some((c) => c.id === i.parentId)).length,
    [state.items, children],
  );
  // The backdrop pops items back out to Favorites; the window itself appends
  // into the folder, so an accidental drop between icons does the sane thing.
  const { setNodeRef: setBackdropRef } = useDroppable({ id: 'container:root', data: { containerId: null } });
  const { setNodeRef: setWindowRef, isOver: windowIsOver } = useDroppable({
    id: `container:${currentId}`,
    data: { containerId: currentId },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (trail.length) setTrail((previous) => previous.slice(0, -1));
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, trail.length]);

  const rename = (title: string) => {
    store.mutate(
      (s) => ({
        ...s,
        items: s.items.map((i) => (i.id === currentId ? { ...i, title, updatedAt: Date.now() } : i)),
        updatedAt: Date.now(),
      }),
      { coalesceKey: `rename:${currentId}` },
    );
  };

  const openChild = (item: Item) => {
    if (item.type === 'folder') setTrail((previous) => [...previous, item.id]);
    else if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
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
          <div className="breadcrumb">
            <button
              type="button"
              onClick={() => setTrail((previous) => previous.slice(0, -1))}
              disabled={!trail.length}
              style={!trail.length ? { opacity: 0.35, color: 'inherit', cursor: 'default' } : undefined}
              aria-label="Back to parent folder"
            >
              ‹ {trail.length ? itemById(state.items, trail[trail.length - 1])?.title ?? 'Back' : folder.title}
            </button>
          </div>
          <input
            className="folder-title-input"
            value={current?.title ?? folder.title}
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
            <div key={child.id} onDoubleClick={() => child.type === 'folder' && openChild(child)}>
              {renderTile(child)}
            </div>
          ))}
          {children.length === 0 && (
            <div className="empty-card" style={{ gridColumn: '1 / -1' }}>
              <span className="glyph" aria-hidden>
                ✦
              </span>
              <div>
                <strong>This folder is empty</strong>
                <p>Drag favorites in, or add a bookmark below.</p>
              </div>
            </div>
          )}
          <button type="button" className="folder-inner-tile" onClick={onNewBookmark} aria-label="Add to folder">
            <span className="tile tile-dashed" style={{ width: 62, height: 62 }}>
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
