import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Item, StoreState, makeBookmark, parseBookmarkHtml, toBookmarkHtml } from '@safari/shared';
import { download } from '../lib/hooks-lib';
import { store } from '../state/store';

/* ------------------------------------------------------------------ */
/* Add / rename sheet                                                  */
/* ------------------------------------------------------------------ */

export interface EditSheetState {
  mode: 'bookmark' | 'folder';
  /** present when editing an existing item */
  item?: Item;
  parentId?: string | null;
}

export function EditSheet({ state, onClose }: { state: EditSheetState; onClose: () => void }) {
  const editing = Boolean(state.item);
  const [title, setTitle] = useState(state.item?.title ?? '');
  const [url, setUrl] = useState(state.item?.url ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = document.getElementById('sheet-title-input') as HTMLInputElement | null;
    node?.focus();
    node?.select();
  }, []);

  const save = () => {
    const cleanTitle = title.trim() || (state.mode === 'folder' ? 'New Folder' : url.trim() || 'Untitled');
    if (state.mode === 'bookmark') {
      let normalized = url.trim();
      if (!normalized) return setError('A URL is required.');
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) normalized = `https://${normalized}`;
      try {
        // eslint-disable-next-line no-new
        new URL(normalized);
      } catch {
        return setError('That URL does not look valid.');
      }
      if (editing && state.item) {
        store.mutate((s) => ({
          ...s,
          items: s.items.map((i) => (i.id === state.item!.id ? { ...i, title: cleanTitle, url: normalized, updatedAt: Date.now() } : i)),
          updatedAt: Date.now(),
        }));
      } else {
        store.mutate((s) => {
          const siblings = s.items.filter((i) => i.parentId === (state.parentId ?? null) && !i.deletedAt);
          const bookmark = makeBookmark(
            { title: cleanTitle, url: normalized },
            state.parentId ?? null,
            siblings.length,
          );
          return { ...s, items: [...s.items, bookmark], updatedAt: Date.now() };
        });
        store.toast(`Saved “${cleanTitle}”`);
      }
    } else if (editing && state.item) {
      store.mutate((s) => ({
        ...s,
        items: s.items.map((i) => (i.id === state.item!.id ? { ...i, title: cleanTitle, updatedAt: Date.now() } : i)),
        updatedAt: Date.now(),
      }));
    }
    onClose();
  };

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.div
        className="sheet glass-strong"
        initial={{ scale: 0.94, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        role="dialog"
        aria-label={editing ? 'Rename' : 'Add bookmark'}
      >
        <h3 className="sheet-title">
          {editing ? (state.mode === 'folder' ? 'Rename Folder' : 'Edit Bookmark') : state.mode === 'folder' ? 'New Folder' : 'New Bookmark'}
        </h3>
        <div className="form-row">
          <label htmlFor="sheet-title-input">Name</label>
          <input
            id="sheet-title-input"
            className="field"
            value={title}
            placeholder={state.mode === 'folder' ? 'Folder name' : 'Page name'}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') onClose();
            }}
          />
        </div>
        {state.mode === 'bookmark' && (
          <div className="form-row">
            <label htmlFor="sheet-url-input">URL</label>
            <input
              id="sheet-url-input"
              className="field"
              value={url}
              placeholder="https://example.com"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
                if (event.key === 'Escape') onClose();
              }}
            />
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            {editing ? 'Save' : 'Add'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm sheet                                                       */
/* ------------------------------------------------------------------ */

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmSheet({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.div
        className="sheet glass-strong"
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        role="alertdialog"
      >
        <h3 className="sheet-title">{state.title}</h3>
        <p className="hint" style={{ fontSize: 12.5 }}>
          {state.message}
        </p>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={state.destructive ? { background: '#ff453a' } : undefined}
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            {state.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Import / export sheet                                               */
/* ------------------------------------------------------------------ */

export function ImportExportSheet({
  appState,
  onClose,
  onImportState,
}: {
  appState: StoreState;
  onClose: () => void;
  onImportState: (state: StoreState) => void;
}) {
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [pasted, setPasted] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const live = appState.items.filter((i) => !i.deletedAt);
    return {
      bookmarks: live.filter((i) => i.type === 'bookmark').length,
      folders: live.filter((i) => i.type === 'folder').length,
    };
  }, [appState.items]);

  const runImport = (text: string) => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Paste a Chrome bookmarks HTML export, or a Safari Start Page JSON backup.');
      return;
    }
    try {
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        const candidates = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(candidates)) throw new Error('No items array found.');
        const result = {
          ...appState,
          items: [...appState.items, ...candidates],
        };
        onImportState(result);
        setFeedback(`Imported ${candidates.length} JSON entries.`);
        return;
      }
      const parsed = parseBookmarkHtml(trimmed, appState);
      onImportState(parsed.state);
      setFeedback(`Imported ${parsed.bookmarks} bookmarks and ${parsed.folders.length} folders.`);
    } catch (importError) {
      setError(`Could not read that file: ${(importError as Error).message}`);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setPasted(text);
    runImport(text);
  };

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.div
        className="sheet glass-strong"
        style={{ width: 'min(94vw, 560px)' }}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="dialog"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="sheet-title" style={{ margin: 0 }}>
            Import &amp; Export
          </h3>
          <div className="segmented">
            <button type="button" aria-pressed={tab === 'import'} onClick={() => setTab('import')}>
              Import
            </button>
            <button type="button" aria-pressed={tab === 'export'} onClick={() => setTab('export')}>
              Export
            </button>
          </div>
        </div>

        {tab === 'import' ? (
          <>
            <p className="hint">
              In Chrome: <kbd>⋮</kbd> → Bookmarks → Bookmark manager → <kbd>⋮</kbd> → Export bookmarks. Then drop the
              file below (or paste its contents).
            </p>
            <input
              type="file"
              accept=".html,.htm,.json,text/html,application/json"
              className="field mt-2"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <textarea
              className="field mt-2"
              style={{ height: 120, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11.5 }}
              placeholder="…or paste the exported HTML / a JSON backup here"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
            {error && <p className="error-text">{error}</p>}
            {feedback && <p className="hint" style={{ marginTop: 8 }}>{feedback}</p>}
            <div className="sheet-actions">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={() => runImport(pasted)}>
                Import
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              You currently have {counts.bookmarks} bookmarks and {counts.folders} folders. Backups are plain files —
              no account needed.
            </p>
            <div className="sheet-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  download(
                    `safari-startpage-${new Date().toISOString().slice(0, 10)}.json`,
                    JSON.stringify(appState, null, 2),
                  );
                }}
              >
                Download JSON backup
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  download(
                    `safari-startpage-${new Date().toISOString().slice(0, 10)}.html`,
                    toBookmarkHtml(appState),
                    'text/html',
                  )
                }
              >
                Download Chrome-style HTML
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(JSON.stringify(appState))
                    .then(() => setFeedback('JSON copied to the clipboard.'))
                    .catch(() => setError('Clipboard permission denied.'));
                }}
              >
                Copy JSON
              </button>
            </div>
            {feedback && <p className="hint mt-3">{feedback}</p>}
            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
