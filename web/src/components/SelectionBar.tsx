import { AnimatePresence, motion } from 'motion/react';
import { Item } from '@safari/shared';

/**
 * Floating action bar shown while tiles are selected — the same idea as Safari's
 * contextual toolbar, and much more discoverable than hiding actions in a menu.
 */
export function SelectionBar({
  items,
  onNewFolder,
  onReadingList,
  onDock,
  onDuplicate,
  onDelete,
  onClear,
}: {
  items: Item[];
  onNewFolder: () => void;
  onReadingList: () => void;
  onDock: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const count = items.length;
  const hasBookmark = items.some((item) => item.type === 'bookmark');

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          className="selection-bar"
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          role="toolbar"
          aria-label="Selection actions"
        >
          <span className="count">
            {count} selected
          </span>
          <button type="button" className="chip" onClick={onNewFolder}>
            New Folder
          </button>
          {hasBookmark && (
            <button type="button" className="chip" onClick={onReadingList}>
              Reading List
            </button>
          )}
          <button type="button" className="chip" onClick={onDock}>
            Dock
          </button>
          <button type="button" className="chip" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="chip destructive" onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="chip" onClick={onClear} aria-label="Clear selection">
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
