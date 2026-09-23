import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Item, childrenOf } from '@safari/shared';
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
  onOpen: (item: Item) => void;
  onSelect: (item: Item, additive: boolean) => void;
  onContextMenu: (item: Item, x: number, y: number) => void;
  onRemoveBadge?: (item: Item) => void;
}

/** The squircle container + icon, without any drag wiring. */
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

const FolderPreviewIcon = memo(function FolderPreviewIcon({ item }: { item: Item }) {
  const { src, onError } = useFaviconSrc(item);
  return <img src={src} alt="" onError={onError} draggable={false} loading="lazy" />;
});

export const BookmarkIcon = memo(function BookmarkIcon({ item }: { item: Item }) {
  const { src, onError } = useFaviconSrc(item);
  return (
    <img className="tile-img" src={src} alt="" draggable={false} loading="lazy" onError={onError} />
  );
});

/** Standalone icon used by the drag ghost and the folder window. */
export function GhostIcon({ item, allItems, size = 76 }: { item: Item; allItems: Item[]; size?: number }) {
  return (
    <TileFace
      item={item}
      allItems={allItems}
      layout={size > 70 ? 'macos' : 'ios'}
      size={size}
    />
  );
}

/**
 * Draggable + droppable tile. Dropping *onto* a tile either reorders (quick drop,
 * the indicator shows where) or merges into a folder (dwell on it first) — the
 * parent decides which, this component only reports state.
 */
export function Tile(props: TileProps) {
  const { item, layout, labels, selected, jiggle } = props;
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

  const handleClick = (event: React.MouseEvent) => {
    if (jiggle || event.metaKey || event.ctrlKey || event.shiftKey) {
      props.onSelect(item, true);
      return;
    }
    props.onOpen(item);
  };

  const classes = [
    'tile-hit',
    isDragging ? 'is-dragging' : '',
    props.isMergeTarget ? 'is-merge-target' : '',
    isOver && !props.isMergeTarget ? 'is-drop-target' : '',
    selected ? 'is-selected' : '',
    jiggle ? 'jiggle' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="tile-slot">
      {props.indicator && <span className={`insert-bar ${props.indicator}`} aria-hidden />}
      <button
        ref={ref}
        type="button"
        className={classes}
        aria-label={item.type === 'folder' ? `Folder ${item.title}` : `Bookmark ${item.title}`}
        title={item.url ?? item.title}
        onClick={handleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(item, event.clientX, event.clientY);
        }}
        {...attributes}
        {...listeners}
      >
        <TileFace item={item} allItems={props.allItems} layout={layout} size={size} />
        {labels && <span className="tile-label">{item.title}</span>}
      </button>
      {jiggle && props.onRemoveBadge && (
        <button
          type="button"
          className="remove-badge"
          aria-label={`Delete ${item.title}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemoveBadge?.(item);
          }}
        />
      )}
    </div>
  );
}

/** "+" tile shown at the end of the Favorites grid. */
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
          <div className="menu add-menu">
            <button
              type="button"
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
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onAddFolder();
              }}
            >
              New Folder
              <span className="shortcut">⌘⇧N</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
