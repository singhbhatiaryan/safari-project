import { motion } from 'motion/react';

/**
 * Two sheets in one: the first-run tips ('tips') and the permanent shortcut
 * reference ('help', opened with the toolbar ? button or the ? key).
 */
export function HelpSheet({
  variant,
  onClose,
  onDismissTips,
}: {
  variant: 'tips' | 'help';
  onClose: () => void;
  onDismissTips?: () => void;
}) {
  const isTips = variant === 'tips';

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.div
        className="sheet glass-strong"
        style={{ width: 'min(94vw, 520px)' }}
        initial={{ scale: 0.94, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        role="dialog"
        aria-label={isTips ? 'Getting started' : 'Shortcuts and gestures'}
      >
        <h3 className="sheet-title">{isTips ? 'Welcome to your Safari start page' : 'Shortcuts & gestures'}</h3>

        {isTips ? (
          <>
            <div className="tips-grid">
              <Tip
                title="Save any tab with ⌘⇧S"
                body="The bundled extension opens a quick-save sheet. ⌘⇧E saves instantly, without the popup. Saves land on this page within a blink."
                glyph="⇧⌘S"
              />
              <Tip
                title="Drag icons together to make a folder"
                body="Drop one favorite onto another and hold for a moment — the target grows, and dropping builds a folder you can open, rename and nest."
                glyph="⇢"
              />
              <Tip
                title="Make it yours"
                body="Wallpapers, light/dark, tinted icons and more live behind the slider button in the bottom-right corner (or ⌘,)."
                glyph="◎"
              />
            </div>
            <div className="sheet-actions" style={{ justifyContent: 'space-between' }}>
              <span className="hint" style={{ maxWidth: 280 }}>
                Press <kbd>?</kbd> any time to see every shortcut and gesture.
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onDismissTips?.();
                  onClose();
                }}
              >
                Got it
              </button>
            </div>
          </>
        ) : (
          <>
            <table className="shortcut-table">
              <tbody>
                <Row keys={['⌘⇧S', 'Ctrl+Shift+S']} label="Save the current tab (extension popup)" />
                <Row keys={['⌘⇧E', 'Ctrl+Shift+E']} label="Save instantly, no popup" />
                <Row keys={['⌘⇧Space']} label="Open this start page from anywhere" />
                <Row keys={['⌘N']} label="New bookmark" />
                <Row keys={['⇧⌘N']} label="New folder" />
                <Row keys={['⌘Z', '⇧⌘Z']} label="Undo / redo" />
                <Row keys={['⌘A']} label="Select every tile in the grid" />
                <Row keys={['Space']} label="Toggle selection on the focused tile" />
                <Row keys={['↑ ↓ ← →']} label="Move between tiles (edges flip iOS pages)" />
                <Row keys={['⌫', 'Delete']} label="Delete the selection" />
                <Row keys={['/']} label="Jump to search" />
                <Row keys={['⌘,']} label="Customize wallpaper and theme" />
                <Row keys={['Esc']} label="Close the top-most panel" />
              </tbody>
            </table>

            <div className="tips-grid mt-4">
              <Tip title="Merge into a folder" body="Drag a tile onto another and pause — the target grows. Drop to build the folder, or drop fast to simply reorder." glyph="⇢" />
              <Tip title="Everything is local" body="No account, no server. Import/Export gives you a JSON backup or a Chrome-compatible bookmarks file." glyph="⌂" />
            </div>

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

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td>
        {keys.map((key) => (
          <kbd key={key} style={{ marginLeft: 4 }}>
            {key}
          </kbd>
        ))}
      </td>
    </tr>
  );
}

function Tip({ title, body, glyph }: { title: string; body: string; glyph: string }) {
  return (
    <div className="tip-card">
      <span className="glyph" aria-hidden>
        <span style={{ fontSize: glyph.length > 2 ? 10 : 15, fontWeight: 600 }}>{glyph}</span>
      </span>
      <div>
        <h4>{title}</h4>
        <p>{body}</p>
      </div>
    </div>
  );
}
