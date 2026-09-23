import { useEffect, useMemo, useState } from 'react';
import {
  StoreState,
  createDefaultState,
  folderTree,
  liveItems,
  sanitize,
  toBookmarkHtml,
  STORAGE_KEY,
} from '@safari/shared';

const MESSAGES = {
  HELLO: 'SAFARI_BRIDGE_HELLO',
  SET_PREFS: 'SAFARI_SET_PREFS',
  OPEN_START_PAGE: 'SAFARI_OPEN_START_PAGE',
} as const;

const NEWTAB_KEY = 'safari.prefs.newtabOptIn';

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

export function Options() {
  const [store, setStore] = useState<StoreState>(() => createDefaultState(false));
  const [defaultFolderId, setDefaultFolderId] = useState<string | null>(null);
  const [openAfter, setOpenAfter] = useState(false);
  const [newTabActive, setNewTabActive] = useState(false);
  const [shortcuts, setShortcuts] = useState<Array<{ name: string; label: string; shortcut: string }>>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const reply = await send<{ state: StoreState }>({ type: MESSAGES.HELLO });
      if (reply?.state) setStore(sanitize(reply.state));

      const raw = await chrome.storage.local.get(['safari.prefs', NEWTAB_KEY]);
      const prefs = (raw?.['safari.prefs'] as { defaultFolderId?: string | null; openAfterSave?: boolean }) ?? {};
      setDefaultFolderId(prefs.defaultFolderId ?? null);
      setOpenAfter(Boolean(prefs.openAfterSave));
      // Chrome reports whether the manifest actually overrides the new tab page.
      setNewTabActive(Boolean(chrome.runtime.getManifest().chrome_url_overrides?.newtab));

      try {
        const commands = await chrome.commands.getAll();
        setShortcuts(
          commands
            .filter((command) => Boolean(command.shortcut))
            .map((command) => ({
              name: command.name ?? '',
              label: LABELS[command.name ?? ''] ?? command.description ?? command.name ?? '',
              shortcut: command.shortcut ?? '',
            })),
        );
      } catch {
        /* commands API unavailable */
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const live = liveItems(store.items);
    return {
      bookmarks: live.filter((i) => i.type === 'bookmark').length,
      folders: live.filter((i) => i.type === 'folder').length,
      wallpapers: store.settings.wallpapers.length,
    };
  }, [store.items, store.settings.wallpapers]);

  const folders = useMemo(() => folderTree(store.items), [store.items]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  const updatePrefs = (patch: Record<string, unknown>) => {
    void send({ type: MESSAGES.SET_PREFS, prefs: patch });
  };

  const exportJson = () => {
    download(
      `safari-startpage-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(store, null, 2),
      'application/json',
    );
    flash('Backup downloaded.');
  };

  const exportHtml = () => {
    download(
      `safari-startpage-${new Date().toISOString().slice(0, 10)}.html`,
      toBookmarkHtml(store),
      'text/html',
    );
    flash('Chrome-compatible bookmarks file downloaded.');
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as StoreState;
      const next = sanitize({ ...store, items: [...store.items, ...(parsed.items ?? [])] });
      await send({ type: 'SAFARI_STORE_PUSH', state: next });
      setStore(next);
      flash(`Imported ${parsed.items?.length ?? 0} entries from JSON.`);
    } catch {
      flash('That file is not a Safari Start Page JSON backup. Use the website to import HTML bookmarks.');
    }
  };

  const resetAll = async () => {
    if (!window.confirm('Delete every bookmark, folder and setting in the extension? This cannot be undone.')) return;
    const fresh = createDefaultState(true);
    await send({ type: 'SAFARI_STORE_PUSH', state: { ...fresh, items: [], stats: {} } });
    setStore({ ...fresh, items: [], stats: {} });
    flash('Everything was cleared.');
  };

  const openStartPage = () => void send({ type: MESSAGES.OPEN_START_PAGE, newTab: true });

  return (
    <div className="page">
      <div className="brand">
        <img src="/icons/icon128.png" alt="" />
        <div>
          <h1>Safari Start Page</h1>
          <p>
            Quick Save settings · v{chrome.runtime.getManifest().version} ·{' '}
            <span className={`badge ${newTabActive ? 'live' : ''}`}>
              {newTabActive ? 'New tab override on' : 'New tab override off'}
            </span>
          </p>
        </div>
      </div>

      {toast && <div className="card" style={{ padding: '10px 16px' }}>{toast}</div>}

      <section className="card">
        <h2>Saving</h2>
        <div className="row">
          <div>
            <div className="label">Default folder</div>
            <div className="sub">Where ⌘⇧S and ⌘⇧E drop new bookmarks when you do not pick a folder in the popup.</div>
          </div>
          <select
            value={defaultFolderId ?? ''}
            aria-label="Default folder"
            onChange={(event) => {
              const value = event.target.value || null;
              setDefaultFolderId(value);
              updatePrefs({ defaultFolderId: value });
            }}
          >
            <option value="">Favorites (root)</option>
            {folders.map(({ item, depth }) => (
              <option key={item.id} value={item.id}>
                {'\u00a0\u00a0'.repeat(depth)}
                {depth > 0 ? '└ ' : ''}
                {item.title}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <div>
            <div className="label">Open the start page after saving</div>
            <div className="sub">Save and jump straight to the page in one keystroke.</div>
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={openAfter}
            aria-label="Open the start page after saving"
            onClick={() => {
              const value = !openAfter;
              setOpenAfter(value);
              updatePrefs({ openAfterSave: value });
            }}
          />
        </div>
      </section>

      <section className="card">
        <h2>Shortcuts</h2>
        <p className="lead">
          These come from Chrome. If a shortcut is missing or clashes with another extension,{' '}
          <a href="chrome://extensions/shortcuts" target="_blank" rel="noreferrer">
            rebind it on Chrome’s shortcuts page
          </a>
          .
        </p>
        <div className="shortcut-grid">
          {(shortcuts.length
            ? shortcuts
            : [
                { name: '_execute_action', label: 'Open the Quick Save popup', shortcut: '' },
                { name: 'instant_save', label: 'Save the current tab instantly', shortcut: '' },
                { name: 'open_start_page', label: 'Open the Safari Start Page', shortcut: '' },
              ]
          ).map((entry) => (
            <div className="shortcut" key={entry.name}>
              <span>{entry.label}</span>
              <span className="keys">
                {entry.shortcut ? (
                  entry.shortcut.split('+').map((key) => <kbd key={key}>{key}</kbd>)
                ) : (
                  <kbd>unassigned</kbd>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>New tab page</h2>
        <p className="lead">
          {newTabActive
            ? 'Every new tab opens your Safari start page. Turn it off by removing the override from the manifest and reloading the extension.'
            : 'Optional: make the Safari start page your new tab page. Chrome only allows this through the manifest, so run the helper once and reload.'}
        </p>
        <div className="actions">
          {!newTabActive && (
            <div className="card" style={{ margin: 0, background: 'transparent', boxShadow: 'none', padding: 0 }}>
              <code style={{ fontSize: 12 }}>npm run newtab on</code>
              <span className="hint"> then Reload on chrome://extensions</span>
            </div>
          )}
          <button type="button" className="btn" onClick={openStartPage}>
            Open the start page now
          </button>
          <button type="button" className="btn ghost" onClick={() => void chrome.runtime.openOptionsPage()}>
            Refresh this page
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="lead">
          {stats.bookmarks} bookmarks · {stats.folders} folders · {stats.wallpapers} custom wallpapers. Everything lives
          in this browser profile — no account, no server.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={exportJson}>
            Download JSON backup
          </button>
          <button type="button" className="btn" onClick={exportHtml}>
            Download bookmarks HTML
          </button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            Import JSON…
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <button type="button" className="btn danger" onClick={() => void resetAll()}>
            Delete everything
          </button>
        </div>
      </section>

      <section className="card">
        <h2>About</h2>
        <p className="lead">
          The start page itself is a website (<code>web/</code>): open it, customise wallpapers and layout, and this
          extension will keep it in sync. Saves appear on any open start page within about 50 ms.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={openStartPage}>
            Open start page
          </button>
          <a className="btn" href="https://github.com/singhbhatiaryan/safari-project" target="_blank" rel="noreferrer">
            Repository
          </a>
        </div>
      </section>

      <p className="hint" style={{ textAlign: 'center' }}>
        Storage key: <code>{STORAGE_KEY}</code>
      </p>
    </div>
  );
}

const LABELS: Record<string, string> = {
  _execute_action: 'Open the Quick Save popup',
  instant_save: 'Save the current tab instantly',
  open_start_page: 'Open the Safari Start Page',
};

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
