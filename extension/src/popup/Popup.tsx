import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Item,
  PageIconInfo,
  StoreState,
  collectPageIcons,
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

/** chrome://favicon gives the browser's own cached, high-res icon for a page. */
function chromeFavicon(url: string): string {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=128`);
}

export function Popup() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [store, setStore] = useState<StoreState>(() => createDefaultState(false));
  const [iconIndex, setIconIndex] = useState(0);
  const [duplicate, setDuplicate] = useState<Item | null>(null);
  const [openAfter, setOpenAfter] = useState(false);
  const [savedItem, setSavedItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

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
          func: collectPageIcons,
        });
        const info = injected?.[0]?.result as PageIconInfo | undefined;
        discovered = info?.icons?.[0] ?? null;
        if (!active.title && info?.title) setTitle(info.title);
      } catch {
        // Not injectable (PDF viewer, web store, a page we lost access to).
      }

      const candidates = [discovered, chromeFavicon(url), active.favIconUrl].filter(
        (v): v is string => Boolean(v),
      );
      setIconCandidates(candidates);
      setPhase('ready');
      window.setTimeout(() => titleRef.current?.select(), 30);
    })();
  }, []);

  const [iconCandidates, setIconCandidates] = useState<string[]>([]);
  const iconSrc = iconCandidates[iconIndex] ?? letterAvatar(title || 'link');

  const folders = useMemo(
    () => folderTree(store.items).map(({ item, depth }) => ({ item, depth })),
    [store.items],
  );

  /* ---------------- actions ---------------- */

  const save = useCallback(async () => {
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
    setSavedItem(reply.item);
    setPhase('saved');
    if (openAfter) {
      await send({ type: MESSAGES.OPEN_START_PAGE, newTab: true });
      window.close();
    }
  }, [tab, iconCandidates, iconIndex, title, folderId, openAfter]);

  const undo = useCallback(async () => {
    if (!savedItem) return;
    await send({ type: MESSAGES.DELETE_ITEMS, ids: [savedItem.id] });
    window.close();
  }, [savedItem]);

  const toggleOpenAfter = (value: boolean) => {
    setOpenAfter(value);
    void send({ type: MESSAGES.SET_PREFS, prefs: { openAfterSave: value } });
  };

  /* ---------------- render ---------------- */

  if (phase === 'loading') {
    return (
      <div className="sheet">
        <header className="header">
          <img src="/icons/icon32.png" alt="" />
          <span>Save to Safari Start Page</span>
        </header>
        <p className="hint">Reading the current tab…</p>
      </div>
    );
  }

  if (phase === 'blocked') {
    return (
      <div className="sheet">
        <header className="header">
          <img src="/icons/icon32.png" alt="" />
          <span>Save to Safari Start Page</span>
        </header>
        <p className="hint">
          Chrome does not let extensions bookmark <code>{tab?.url || 'this page'}</code>. Open a normal web page and try
          again.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void send({ type: MESSAGES.OPEN_START_PAGE })}>
            Open Start Page
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'saved' && savedItem) {
    return (
      <div className="sheet">
        <header className="header">
          <img src="/icons/icon32.png" alt="" />
          <span>Save to Safari Start Page</span>
        </header>
        <div className="saved">
          <div className="check" aria-hidden>
            ✓
          </div>
          <h2>{savedItem.title}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {folderId ? 'Saved inside a folder on your start page.' : 'Saved to your Favorites grid.'}
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
        <p className="hint" style={{ textAlign: 'center' }}>
          Tip: <kbd>⌘⇧E</kbd> saves the active tab without opening this popup.
        </p>
      </div>
    );
  }

  return (
    <div className="sheet">
      <header className="header">
        <img src="/icons/icon32.png" alt="" />
        <span>Save to Safari Start Page</span>
      </header>

      <div className="preview">
        <div className="tile">
          <img
            src={iconSrc}
            alt=""
            onError={() => setIconIndex((index) => index + 1)}
          />
        </div>
        <div className="preview-body">
          <input
            ref={titleRef}
            className="title-input"
            value={title}
            placeholder="Page title"
            aria-label="Page title"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
              if (event.key === 'Escape') window.close();
            }}
          />
          <span className="url" title={tab?.url}>
            {hostnameOf(tab?.url ?? '')}
            {tab?.url ? new URL(tab.url).pathname.replace(/\/$/, '') : ''}
          </span>
        </div>
      </div>

      {duplicate && (
        <p className="hint" style={{ margin: 0 }}>
          Already on your start page
          {duplicate.type === 'folder' ? ' inside a folder' : ''} — saving again creates a second tile.
        </p>
      )}

      <div>
        <label className="label" htmlFor="folder">
          Save to
        </label>
        <select id="folder" value={folderId ?? ''} onChange={(event) => setFolderId(event.target.value || null)}>
          <option value="">Favorites</option>
          {folders.map(({ item, depth }) => (
            <option key={item.id} value={item.id} className="folder-option">
              {'\u00a0\u00a0'.repeat(depth)}
              {depth > 0 ? '└ ' : ''}
              {item.title}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <span>Open start page after saving</span>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={openAfter}
          aria-label="Open start page after saving"
          onClick={() => toggleOpenAfter(!openAfter)}
        />
      </div>

      {error && <p className="hint" style={{ color: '#ff453a', margin: 0 }}>{error}</p>}

      <div className="actions">
        <button type="button" className="btn" onClick={() => window.close()}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save Bookmark
        </button>
      </div>

      <p className="hint" style={{ margin: 0 }}>
        <kbd>⌘⇧S</kbd> opens this popup anywhere · <kbd>⌘⇧E</kbd> saves instantly ·{' '}
        <kbd>⌘⇧Space</kbd> opens the start page
      </p>
    </div>
  );
}
