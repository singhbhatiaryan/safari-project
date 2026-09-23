import { LayoutMode } from '@safari/shared';

/** Compact glass toolbar that replaces the loose row of buttons. */
export function Toolbar({
  connected,
  canUndo,
  canRedo,
  jiggle,
  layout,
  onUndo,
  onRedo,
  onAddBookmark,
  onAddFolder,
  onImportExport,
  onToggleJiggle,
  onSync,
  onLayoutChange,
  onOpenHelp,
  onCustomize,
}: {
  connected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  jiggle: boolean;
  layout: LayoutMode;
  onUndo: () => void;
  onRedo: () => void;
  onAddBookmark: () => void;
  onAddFolder: () => void;
  onImportExport: () => void;
  onToggleJiggle: () => void;
  onSync: () => void;
  onLayoutChange: (layout: LayoutMode) => void;
  onOpenHelp: () => void;
  onCustomize: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
      <button
        type="button"
        className="connection-pill"
        onClick={onSync}
        title={
          connected
            ? 'Connected to the Safari Start Page extension — saves from any tab land here instantly. Click to re-sync.'
            : 'Extension not detected. Install extension/release to save tabs with ⌘⇧S. Click to retry.'
        }
      >
        <span className={`connection-dot ${connected ? 'live' : 'off'}`} />
        {connected ? 'Extension connected' : 'Local only'}
      </button>

      <div className="glass-toolbar">
        <div className="segmented" role="group" aria-label="Layout">
          <button type="button" aria-pressed={layout === 'macos'} onClick={() => onLayoutChange('macos')} title="macOS Safari start page">
            Safari
          </button>
          <button type="button" aria-pressed={layout === 'ios'} onClick={() => onLayoutChange('ios')} title="iOS Home Screen">
            iOS
          </button>
        </div>

        <span className="toolbar-sep" />

        <button
          type="button"
          className="tool-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          aria-label="Undo"
        >
          <UndoGlyph />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⇧⌘Z)"
          aria-label="Redo"
        >
          <RedoGlyph />
        </button>

        <span className="toolbar-sep" />

        <button type="button" className="tool-btn" onClick={onAddBookmark} title="New bookmark (⌘N)">
          <PlusGlyph />
          Bookmark
        </button>
        <button type="button" className="tool-btn" onClick={onAddFolder} title="New folder (⇧⌘N)">
          <FolderGlyph />
          Folder
        </button>

        <span className="toolbar-sep" />

        {jiggle ? (
          <button type="button" className="tool-btn is-ready" onClick={onToggleJiggle} title="Finish editing">
            Done
          </button>
        ) : (
          layout === 'ios' && (
            <button type="button" className="tool-btn" onClick={onToggleJiggle} title="Jiggle to rearrange or delete">
              <EditGlyph />
              Edit
            </button>
          )
        )}

        <button type="button" className="tool-btn" onClick={onImportExport} title="Import or export bookmarks">
          <ImportGlyph />
          <span className="hidden sm:inline">Import / Export</span>
        </button>
        <button type="button" className="tool-btn" onClick={onCustomize} title="Wallpaper, theme and layout (⌘,)">
          <SlidersGlyph />
        </button>
        <button type="button" className="tool-btn" onClick={onOpenHelp} title="Keyboard shortcuts and gestures (?)">
          <HelpGlyph />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* glyphs (16px, 1.6 stroke — matching the rest of the chrome)        */
/* ------------------------------------------------------------------ */

const base = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function UndoGlyph() {
  return (
    <svg {...base}>
      <path d="M4 10h9.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="M8 5 3.5 10 8 15" />
    </svg>
  );
}

function RedoGlyph() {
  return (
    <svg {...base}>
      <path d="M20 10h-9.5a5.5 5.5 0 0 0 0 11H16" />
      <path d="m16 5 4.5 5L16 15" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg {...base}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2.2a2 2 0 0 1 1.6.8l.9 1.2H17.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg {...base}>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 6.5 3 3" />
    </svg>
  );
}

function ImportGlyph() {
  return (
    <svg {...base}>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

function HelpGlyph() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2.9-1.2 1.8" />
      <path d="M12 16.6h.01" />
    </svg>
  );
}

export function SlidersGlyph() {
  return (
    <svg {...base}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.1" />
      <circle cx="9" cy="17" r="2.1" />
    </svg>
  );
}
