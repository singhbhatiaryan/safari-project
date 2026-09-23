import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Item,
  StoreState,
  containsUrl,
  createDefaultState,
  folderTree,
  hostnameOf,
  letterAvatar,
  sanitize,
} from '@safari/shared';

type Phase = 'loading' | 'ready' | 'saved' | 'blocked';

interface TabInfo {
  id?: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

const MESSAGES = {
  HELLO: 'SAFARI_BRIDGE_HELLO',
  SAVE_TAB: 'SAFARI_SAVE_TAB',
  DELETE_ITEMS: 'SAFARI_DELETE_ITEMS',
  SET_PREFS: 'SAFARI_SET_PREFS',
  OPEN_START_PAGE: 'SAFARI_OPEN_START_PAGE',
  OPEN_OPTIONS: 'SAFARI_OPEN_OPTIONS',
} as const;

function send<T>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        void chrome.runtime.lastError;
        resolve(reply as T | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/** Chrome's own cached icon, usually sharper than anything on the page. */
function chromeFavicon(url: string): string {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=128`);
}

export function Popup() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [store, setStore] = useState<StoreState>(() => createDefaultState(false));
  const [iconCandidates, setIconCandidates] = useState<string[]>([]);
  const [iconIndex, setIconIndex] = useState(0);
  const [duplicate, setDuplicate] = useState<Item | null>(null);
  const [openAfter, setOpenAfter] = useState(false);
  const [savedItem, setSavedItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderQuery, setFolderQuery] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  /* ---------------- init ---------------- */
  useEffect(() => {
    void (async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = active?.url ?? '';
      if (!active || !url || /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/i.test(url)) {
        setTab({ title: active?.title ?? '', url });
        setPhase('blocked');
        return;
      }

      setTab({ id: active.id, title: active.title ?? '', url, favIconUrl: active.favIconUrl });
      setTitle(active.title ?? '');

      const reply = await send<{ state: StoreState }>({ type: MESSAGES.HELLO });
      const state = reply?.state ? sanitize(reply.state) : createDefaultState(false);
      setStore(state);
      setDuplicate(containsUrl(state.items, url, null) ?? null);

      void chrome.storage.local.get('safari.prefs').then((raw) => {
        const prefs = (raw?.['safari.prefs'] as { openAfterSave?: boolean; defaultFolderId?: string | null }) ?? {};
        setOpenAfter(Boolean(prefs.openAfterSave));
        if (prefs.defaultFolderId) setFolderId(prefs.defaultFolderId);
      });

      // Ask the page for its real apple-touch-icon (activeTab + scripting).
      let discovered: string | null = null;
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: active.id as number, frameIds: [0] },
          func: () => {
            const toAbsolute = (href: string | null) => {
              if (!href) return null;
              try {
                return new URL(href, document.baseURI).href;
              } catch {
                return null;
              }
            };
            const scored: Array<{ href: string; size: number }> = [];
            for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel]'))) {
              const rel = (link.getAttribute('rel') || '').toLowerCase();
              if (!rel.includes('icon')) continue;
              const href = toAbsolute(link.getAttribute('href'));
              if (!href || href.startsWith('data:')) continue;
              const match = (link.getAttribute('sizes') || '').match(/(\d+)\s*x\s*(\d+)/i);
              let size = match ? Number(match[1]) : 0;
              if (rel.includes('apple-touch-icon')) size = Math.max(size, 180);
              if (href.endsWith('.svg')) size += 40;
              scored.push({ href, size });
            }
            scored.sort((a, b) => b.size - a.size);
            return scored.slice(0, 3).map((s) => s.href);
          },
        });
        discovered = (injected?.[0]?.result as string[] | undefined)?.[0] ?? null;
      } catch {
        /* not injectable (PDF viewer, web store, or we lost access) */
      }

      setIconCandidates([discovered, chromeFavicon(url), active.favIconUrl].filter((v): v is string => Boolean(v)));
      setPhase('ready');
    })();
  }, []);

  const iconSrc = iconCandidates[iconIndex] ?? letterAvatar(title || 'link');

  const folders = useMemo(() => folderTree(store.items), [store.items]);
  const filteredFolders = useMemo(() => {
    const query = folderQuery.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter(({ item }) => item.title.toLowerCase().includes(query));
  }, [folders, folderQuery]);

  const destinationLabel = folderId
    ? item_label(store, folderId)
    : 'Favorites';

  /* ---------------- actions ---------------- */

  const save = useCallback(
    async (options: { openAfterwards?: boolean } = {}) => {
      if (!tab) return;
      const favicon = iconCandidates[iconIndex] ?? null;
      const reply = await send<{ ok: boolean; item?: Item }>({
        type: MESSAGES.SAVE_TAB,
        payload: { title: title.trim() || tab.url, url: tab.url, favicon, parentId: folderId },
      });
      if (!reply?.item) {
        setError('Could not save — try reloading the extension.');
        return;
      }
      void send({ type: MESSAGES.SET_PREFS, prefs: { defaultFolderId: folderId } });
      setSavedItem(reply.item);
      setPhase('saved');
      if (options.openAfterwards || openAfter) {
        await send({ type: MESSAGES.OPEN_START_PAGE, newTab: true });
        window.close();
      }
    },
    [tab, iconCandidates, iconIndex, title, folderId, openAfter],
  );

  const undo = useCallback(async () => {
    if (!savedItem) return;
    await send({ type: MESSAGES.DELETE_ITEMS, ids: [savedItem.id] });
    window.close();
  }, [savedItem]);

  const toggleOpenAfter = (value: boolean) => {
    setOpenAfter(value);
    void send({ type: MESSAGES.SET_PREFS, prefs: { openAfterSave: value } });
  };

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.close();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save({ openAfterwards: true });
        return;
      }
      if (event.key === 'Enter' && phase === 'ready' && !folderPickerOpen) {
        const target = event.target as HTMLElement;
        if (target.tagName !== 'BUTTON') {
          event.preventDefault();
          void save();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, phase, folderPickerOpen]);

  /* ---------------- render ---------------- */

  if (phase === 'loading') {
    return (
      <div className="sheet">
        <Header />
        <p className="hint">Reading the current tab…</p>
      </div>
    );
  }

  if (phase === 'blocked') {
    return (
      <div className="sheet">
        <Header />
        <div className="notice">
          <strong>Chrome keeps this page private</strong>
          <p>
            Extensions cannot bookmark <code>{shortUrl(tab?.url)}</code>. Open a normal web page and try again.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => void send({ type: MESSAGES.OPEN_OPTIONS })}>
            Settings
          </button>
          <button type="button" className="btn primary" onClick={() => void send({ type: MESSAGES.OPEN_START_PAGE })}>
            Open Start Page
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'saved' && savedItem) {
    return (
      <div className="sheet">
        <Header />
        <div className="saved">
          <div className="check" aria-hidden>
            ✓
          </div>
          <h2>{savedItem.title}</h2>
          <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
            Saved to <strong>{savedItem.parentId ? item_label(store, savedItem.parentId) : 'Favorites'}</strong>. It is
            already on any open start page.
          </p>
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={() => void undo()}>
              Undo
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void send({ type: MESSAGES.OPEN_START_PAGE, newTab: true });
                window.close();
              }}
            >
              Open Start Page
            </button>
          </div>
        </div>
        <p className="hint" style={{ textAlign: 'center', margin: 0 }}>
          <kbd>⌘⇧E</kbd> saves the active tab without ever opening this popup.
        </p>
      </div>
    );
  }

  return (
    <div className="sheet">
      <Header />

      <div className="preview">
        <div className="tile">
          <img src={iconSrc} alt="" onError={() => setIconIndex((index) => index + 1)} />
        </div>
        <div className="preview-body">
          <input
            className="title-input"
            value={title}
            placeholder="Page title"
            aria-label="Page title"
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
          <span className="url" title={tab?.url}>
            {hostLabel(tab?.url ?? '')}
            {pathOf(tab?.url)}
          </span>
        </div>
      </div>

      {duplicate && (
        <div className="duplicate">
          <span>Already on your start page.</span>
          <span className="duplicate-actions">
            <button type="button" className="mini" onClick={() => setDuplicate(null)}>
              Save anyway
            </button>
            <button
              type="button"
              className="mini"
              onClick={() => {
                void send({ type: MESSAGES.OPEN_START_PAGE, newTab: true });
                window.close();
              }}
            >
              Show me
            </button>
          </span>
        </div>
      )}

      <div className="field-block">
        <span className="label">Save to</span>
        <div className="combo">
          <button
            type="button"
            className="combo-trigger"
            aria-haspopup="listbox"
            aria-expanded={folderPickerOpen}
            onClick={() => setFolderPickerOpen((v) => !v)}
          >
            <span className="ellipsis">{destinationLabel}</span>
            <span aria-hidden style={{ opacity: 0.6 }}>
              ▾
            </span>
          </button>
          {folderPickerOpen && (
            <div className="combo-list" role="listbox">
              <input
                className="combo-search"
                placeholder="Find a folder…"
                aria-label="Find a folder"
                autoFocus
                value={folderQuery}
                onChange={(event) => setFolderQuery(event.target.value)}
              />
              <button
                type="button"
                className="combo-option"
                aria-selected={folderId === null}
                onClick={() => {
                  setFolderId(null);
                  setFolderPickerOpen(false);
                }}
              >
                <span>Favorites</span>
                <span className="hint">root</span>
              </button>
              {filteredFolders.map(({ item, depth }) => (
                <button
                  key={item.id}
                  type="button"
                  className="combo-option"
                  aria-selected={folderId === item.id}
                  style={{ paddingLeft: 9 + depth * 14 }}
                  onClick={() => {
                    setFolderId(item.id);
                    setFolderPickerOpen(false);
                  }}
                >
                  <span className="ellipsis">{item.title}</span>
                  {depth > 0 && <span className="hint">nested</span>}
                </button>
              ))}
              {filteredFolders.length === 0 && <p className="hint" style={{ padding: '6px 9px' }}>No folder matches.</p>}
            </div>
          )}
        </div>
      </div>

      <div className="row">
        <span>Open the start page after saving</span>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={openAfter}
          aria-label="Open the start page after saving"
          onClick={() => toggleOpenAfter(!openAfter)}
        />
      </div>

      {error && <p className="hint error">{error}</p>}

      <div className="actions">
        <button type="button" className="btn ghost" onClick={() => void send({ type: MESSAGES.OPEN_OPTIONS })}>
          Settings
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => window.close()}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save Bookmark
        </button>
      </div>

      <p className="hint footer-hint">
        <kbd>⌘⏎</kbd> save &amp; open · <kbd>⌘⇧E</kbd> save without this popup · <kbd>⌘⇧Space</kbd> open the start page
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header() {
  return (
    <header className="header">
      <img src="/icons/icon32.png" alt="" />
      <span>Save to Safari Start Page</span>
    </header>
  );
}

function item_label(store: StoreState, id: string): string {
  return store.items.find((item) => item.id === id)?.title ?? 'Favorites';
}

function hostLabel(url: string): string {
  return hostnameOf(url) ?? '';
}

function pathOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname.replace(/\/$/, '').slice(0, 28);
  } catch {
    return '';
  }
}

function shortUrl(url: string | undefined): string {
  if (!url) return 'this page';
  return url.length > 42 ? `${url.slice(0, 40)}…` : url;
}
