import { useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { AnimatePresence, motion } from 'motion/react';
import { Item, READING_ID, SearchEngineId, StoreState, liveItems } from '@safari/shared';
import { Toast } from '../state/store';
import { hostLabel, useFaviconSrc } from '../lib/hooks-lib';

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const ENGINES: Record<Exclude<SearchEngineId, 'none'>, { name: string; url: (q: string) => string }> = {
  google: { name: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  duckduckgo: { name: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  bing: { name: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: { name: 'Brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  wikipedia: { name: 'Wikipedia', url: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}` },
};

export function SearchField({
  engine,
  state,
  onOpenItem,
  inputRef,
}: {
  engine: SearchEngineId;
  state: StoreState;
  onOpenItem: (item: Item, newTab: boolean) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return liveItems(state.items)
      .filter((i) => i.title.toLowerCase().includes(q) || (i.url ?? '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, state.items]);

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    if (matches.length && (q.startsWith('!') || matches[0].title.toLowerCase().startsWith(q))) {
      // A strong title hit is what the user probably meant.
      onOpenItem(matches[0], state.settings.openInNewTab);
      return;
    }
    if (engine === 'none') return;
    const target = ENGINES[engine].url(q);
    if (state.settings.openInNewTab) window.open(target, '_blank', 'noopener,noreferrer');
    else window.location.href = target;
  };

  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: 560 }}>
      <div className="search-wrap">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={engine === 'none' ? 'Search bookmarks…' : `Search ${ENGINES[engine]?.name ?? ''} or your bookmarks…`}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
            if (event.key === 'Escape') {
              setQuery('');
              (event.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Search"
        />
        {query ? (
          <button type="button" className="btn btn-ghost" onClick={() => setQuery('')} aria-label="Clear search">
            ✕
          </button>
        ) : (
          <span className="engine-chip" title={engine === 'none' ? 'Bookmarks only' : `Searches ${ENGINES[engine]?.name}`}>
            {engine === 'none' ? 'Bookmarks' : ENGINES[engine]?.name}
          </span>
        )}
      </div>
      <AnimatePresence>
        {focused && matches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="menu glass-strong"
            style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)' }}
          >
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                className="menu-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onOpenItem(item, state.settings.openInNewTab);
                  setQuery('');
                }}
              >
                <span className="flex items-center gap-2 truncate">
                  <SearchResultIcon item={item} />
                  <span className="truncate">{item.title}</span>
                </span>
                <span className="shortcut">{item.type === 'folder' ? 'Folder' : hostLabel(item.url)}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SearchResultIcon({ item }: { item: Item }) {
  const { src, onError } = useFaviconSrc(item);
  return <img src={src} alt="" width={15} height={15} onError={onError} />;
}

/* ------------------------------------------------------------------ */
/* Reading list                                                        */
/* ------------------------------------------------------------------ */

export function ReadingList({
  items,
  onOpen,
  onContextMenu,
  onRemove,
}: {
  items: Item[];
  onOpen: (item: Item) => void;
  onContextMenu: (item: Item, x: number, y: number) => void;
  onRemove: (item: Item) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `container:${READING_ID}`, data: { containerId: READING_ID } });
  return (
    <section className="section" aria-label="Reading list">
      <h2 className="section-title">Reading List</h2>
      <div
        ref={setNodeRef}
        className={`reading-list dropzone p-2 rounded-2xl ${isOver ? 'is-over' : ''}`}
        style={{ maxWidth: 760 }}
      >
        {items.length === 0 ? (
          <div className="empty-card">
            <span className="glyph" aria-hidden>
              ☰
            </span>
            <div>
              <strong>Nothing saved for later</strong>
              <p>Drag a favorite here, or use “Add to Reading List” from a tile’s context menu.</p>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <ReadingRow
              key={item.id}
              item={item}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ReadingRow({
  item,
  onOpen,
  onContextMenu,
  onRemove,
}: {
  item: Item;
  onOpen: (item: Item) => void;
  onContextMenu: (item: Item, x: number, y: number) => void;
  onRemove: (item: Item) => void;
}) {
  const { src, onError } = useFaviconSrc(item);
  return (
    <div
      className="reading-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(item, event.clientX, event.clientY);
      }}
      title={item.url ?? item.title}
    >
      <img src={src} alt="" onError={onError} />
      <span className="min-w-0">
        <span className="title block">{item.title}</span>
        <span className="host block">{hostLabel(item.url)}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="host">
          {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
        <span className="row-actions">
          <button
            type="button"
            title="Remove from Reading List"
            aria-label={`Remove ${item.title} from Reading List`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(item);
            }}
          >
            ✕
          </button>
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy report                                                      */
/* ------------------------------------------------------------------ */

export function PrivacyReport({ state }: { state: StoreState }) {
  const stats = useMemo(() => {
    const live = liveItems(state.items);
    const bookmarks = live.filter((i) => i.type === 'bookmark');
    const folders = live.filter((i) => i.type === 'folder');
    const hosts = new Set(bookmarks.map((b) => hostLabel(b.url)).filter(Boolean));
    const week = Date.now() - 1000 * 60 * 60 * 24 * 7;
    const recent = bookmarks.filter((b) => b.createdAt > week).length;
    return { bookmarks: bookmarks.length, folders: folders.length, hosts: hosts.size, recent };
  }, [state.items]);

  const bars = useMemo(() => {
    const counts = new Array(7).fill(0);
    const day = 1000 * 60 * 60 * 24;
    const today = new Date().setHours(0, 0, 0, 0);
    for (const item of liveItems(state.items)) {
      const index = 6 - Math.floor((today - new Date(item.createdAt).setHours(0, 0, 0, 0)) / day);
      if (index >= 0 && index < 7) counts[index] += 1;
    }
    return counts;
  }, [state.items]);

  const max = Math.max(1, ...bars);

  return (
    <section className="section" aria-label="Privacy report">
      <h2 className="section-title">Privacy Report</h2>
      <div className="privacy-card glass">
        <h4>Nothing to block — this page never phones home.</h4>
        <div className="stat-row">
          <span className="stat">
            <b>{stats.bookmarks}</b>
            <span>bookmarks</span>
          </span>
          <span className="stat">
            <b>{stats.folders}</b>
            <span>folders</span>
          </span>
          <span className="stat">
            <b>{stats.hosts}</b>
            <span>sites</span>
          </span>
          <span className="stat">
            <b>{stats.recent}</b>
            <span>added this week</span>
          </span>
        </div>
        <p>No account, no analytics, no server — everything lives in this browser profile.</p>
        <div className="privacy-bars" aria-hidden>
          {bars.map((value, index) => (
            <i key={index} style={{ height: `${Math.max(12, (value / max) * 100)}%` }} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Status + toasts                                                     */
/* ------------------------------------------------------------------ */

export function StatusPill({ connected, onSync }: { connected: boolean; onSync: () => void }) {
  return (
    <button
      type="button"
      className="status-pill"
      onClick={onSync}
      title={
        connected
          ? 'Connected to the Safari Start Page extension — saves from any tab land here instantly.'
          : 'Extension not detected. Install it to save tabs from the toolbar or with a shortcut.'
      }
    >
      <span className={`status-dot ${connected ? 'live' : ''}`} />
      {connected ? 'Extension connected' : 'Local only — install the extension'}
    </button>
  );
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div aria-live="polite">
      <AnimatePresence>
        {toasts.slice(-3).map((toast, index) => (
          <motion.div
            key={toast.id}
            className="toast"
            style={{ bottom: 22 + index * 54 }}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <span>{toast.message}</span>
            {typeof toast.duration === 'number' && (
              <span
                className="toast-progress"
                style={{ animation: `toast-countdown ${toast.duration}ms linear forwards` }}
                aria-hidden
              />
            )}
            {toast.actionLabel && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  toast.action?.();
                  onDismiss(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            <button type="button" className="btn btn-ghost" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Focus-ref helper used by keyboard shortcuts. */
export function useSearchInput() {
  const ref = useRef<HTMLInputElement | null>(null);
  return ref;
}
