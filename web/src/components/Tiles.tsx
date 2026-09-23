import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Item, childrenOf, initialOf, tintFor } from '@safari/shared';
import { squircle } from '../lib/squircle';
import { useFaviconSrc } from '../lib/hooks-lib';

export type Indicator = 'before' | 'after' | null;

export interface TileProps {
  item: Item;
  /** all live items, needed to render a folder's contents */
  allItems: Item[];
  layout: 'macos' | 'ios';
  labels: boolean;
  jiggle: boolean;
  selected: boolean;
  isMergeTarget: boolean;
  indicator: Indicator;
  /** shown as a small counter (used by Frequently Visited) */
  visits?: number;
  onOpen: (item: Item) => void;
  onSelect: (item: Item, additive: boolean) => void;
  onContextMenu: (item: Item, x: number, y: number) => void;
  onRemoveBadge?: (item: Item) => void;
}

/* ------------------------------------------------------------------ */
/* images                                                             */
/* ------------------------------------------------------------------ */

/**
 * Fades an icon in once it has decoded, and paints a deterministic letter tile
 * underneath so a slow or blocked favicon never shows as a hole in the grid.
 */
function SmartIcon({
  src,
  fallback,
  title,
  className = 'tile-img',
  onError,
}: {
  src: string | null;
  fallback: string;
  title: string;
  className?: string;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const useLetter = !src || failed;

  return (
    <>
      {useLetter ? (
        <span className="tile-letter" style={{ background: tintFor(title || 'x') }} aria-hidden>
          {initialOf(title)}
        </span>
      ) : (
        <img
          className={`${className} ${loaded ? 'is-loaded' : ''}`}
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            onError?.();
          }}
        />
      )}
      {!useLetter && !loaded && fallback ? (
        <img className={className} src={fallback} alt="" aria-hidden draggable={false} />
      ) : null}
    </>
  );
}

const FolderPreviewIcon = memo(function FolderPreviewIcon({ item }: { item: Item }) {
  const { src, onError } = useFaviconSrc(item);
  return <SmartIcon src={src} fallback="" title={item.title} onError={onError} />;
});

export const BookmarkIcon = memo(function BookmarkIcon({ item }: { item: Item }) {
  const { src, onError } = useFaviconSrc(item);
  return <SmartIcon src={src} fallback="" title={item.title} onError={onError} />;
});

/* ------------------------------------------------------------------ */
/* faces                                                              */
/* ------------------------------------------------------------------ */

export const TileFace = memo(function TileFace({
  item,
  allItems,
  layout,
  size,
}: {
  item: Item;
  allItems: Item[];
  layout: 'macos' | 'ios';
  size: number;
}) {
  const style: CSSProperties = {
    clipPath: squircle(size),
    WebkitClipPath: squircle(size),
    borderRadius: 0,
  };
  const children = item.type === 'folder' ? childrenOf(allItems, item.id) : [];
  return (
    <div className={`tile ${layout === 'ios' ? 'tile-ios' : ''}`} style={style}>
      {item.type === 'folder' ? (
        <div className="folder-mini">
          {Array.from({ length: 9 }).map((_, index) => {
            const child = children[index];
            return child ? (
              <FolderPreviewIcon key={child.id} item={child} />
            ) : (
              <span key={`empty-${index}`} aria-hidden />
            );
          })}
        </div>
      ) : (
        <BookmarkIcon item={item} />
      )}
    </div>
  );
});

export function GhostIcon({ item, allItems, size = 76 }: { item: Item; allItems: Item[]; size?: number }) {
  return <TileFace item={item} allItems={allItems} layout={size > 70 ? 'macos' : 'ios'} size={size} />;
}

/* ------------------------------------------------------------------ */
/* tile                                                               */
/* ------------------------------------------------------------------ */

/**
 * Draggable + droppable tile.
 *
 * Props are primitives plus stable callbacks so `memo` can bail out: selecting one
 * tile, or hovering a merge target, only re-renders the tiles that actually changed.
 */
export const Tile = memo(function Tile(props: TileProps) {
  const { item, layout, labels, selected, jiggle, isMergeTarget, indicator, visits } = props;
  const size = layout === 'macos' ? 76 : 62;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag:${item.id}`,
    data: { itemId: item.id },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `item:${item.id}`,
    data: { itemId: item.id, containerId: item.parentId },
  });

  const ref = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node as HTMLElement | null);
      setDropRef(node as HTMLElement | null);
    },
    [setDragRef, setDropRef],
  );

  const { onOpen, onSelect, onContextMenu, onRemoveBadge } = props;

  const handleClick = (event: React.MouseEvent) => {
    if (jiggle || event.metaKey || event.ctrlKey || event.shiftKey) {
      onSelect(item, true);
      return;
    }
    onOpen(item);
  };

  const classes = [
    'tile-hit',
    isDragging ? 'is-dragging' : '',
    isMergeTarget ? 'is-merge-target' : '',
    isOver && !isMergeTarget ? 'is-drop-target' : '',
    selected ? 'is-selected' : '',
    jiggle ? 'jiggle' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="tile-slot" data-item-id={item.id}>
      {indicator && <span className={`insert-bar ${indicator}`} aria-hidden />}
      <button
        ref={ref}
        type="button"
        className={classes}
        aria-label={
          item.type === 'folder'
            ? `Folder ${item.title}`
            : `Open ${item.title}${visits ? `, opened ${visits} time${visits === 1 ? '' : 's'}` : ''}`
        }
        title={item.url ?? item.title}
        onClick={handleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(item, event.clientX, event.clientY);
        }}
        {...listeners}
        {...attributes}
        aria-pressed={selected}
      >
        <TileFace item={item} allItems={props.allItems} layout={layout} size={size} />
        {labels && <span className="tile-label">{item.title}</span>}
        {selected && (
          <span className="selection-check" aria-hidden>
            ✓
          </span>
        )}
      </button>
      {jiggle && onRemoveBadge && (
        <button
          type="button"
          className="remove-badge"
          aria-label={`Delete ${item.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveBadge(item);
          }}
        />
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* add tile                                                           */
/* ------------------------------------------------------------------ */

export function AddTile({
  onAddBookmark,
  onAddFolder,
  layout,
}: {
  onAddBookmark: () => void;
  onAddFolder: () => void;
  layout: 'macos' | 'ios';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="tile-slot">
      <div className="relative" ref={wrap}>
        <button
          type="button"
          className="tile-hit"
          aria-label="Add bookmark or folder"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <div className={`tile ${layout === 'ios' ? 'tile-ios' : ''} tile-dashed`}>
            <span className="tile-glyph" aria-hidden>
              +
            </span>
          </div>
          <span className="tile-label">Add</span>
        </button>
        {open && (
          <div className="menu add-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onAddBookmark();
              }}
            >
              New Bookmark
              <span className="shortcut">⌘N</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onAddFolder();
              }}
            >
              New Folder
              <span className="shortcut">⇧⌘N</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
