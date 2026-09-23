/**
 * First-run page, opened once right after installation.
 *
 * It exists because the extension's best features are invisible until you know
 * they are there: two shortcuts and an optional new-tab override.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../options/options.css';

function Welcome() {
  const [host, setHost] = useState('http://localhost:5173');
  const [newTab, setNewTab] = useState(false);

  useEffect(() => {
    setNewTab(Boolean(chrome.runtime.getManifest().chrome_url_overrides?.newtab));
    void chrome.storage.local
      .get('safari.startPageUrl')
      .then((raw: Record<string, unknown>) => {
        const value = raw?.['safari.startPageUrl'];
        if (typeof value === 'string' && value) setHost(value);
      })
      .catch(() => undefined);
  }, []);

  const openHost = () => void chrome.tabs.create({ url: host });
  const openNewTab = () => void chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="brand">
        <img src="/icons/icon128.png" alt="" />
        <div>
          <h1>Your Safari start page is ready</h1>
          <p>Two shortcuts and one optional switch, and you are done.</p>
        </div>
      </div>

      <section className="card">
        <h2>Three things worth knowing</h2>
        <div className="steps">
          <div className="step">
            <span className="num">1</span>
            <div>
              <h3>
                Save a tab with <kbd>⌘⇧S</kbd>
              </h3>
              <p>
                A frosted sheet opens with the page title, its real Apple touch icon and a folder picker. Press{' '}
                <kbd>⌘⇧E</kbd> instead to save instantly, without the popup.
              </p>
            </div>
          </div>
          <div className="step">
            <span className="num">2</span>
            <div>
              <h3>
                Open the start page with <kbd>⌘⇧Space</kbd>
              </h3>
              <p>
                Drag tiles onto each other to build folders, drop a tile on the Dock or the Reading List, and customise
                the wallpaper from the button in the bottom-right corner.
              </p>
            </div>
          </div>
          <div className="step">
            <span className="num">3</span>
            <div>
              <h3>Point it at your copy of the site</h3>
              <p>
                The extension syncs with the start page you are running. By default that is the dev server at{' '}
                <code>{host}</code>. Hosting it elsewhere? Add that origin to the extension’s content script matches.
              </p>
            </div>
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn primary" onClick={openHost}>
            Open the start page
          </button>
          <button type="button" className="btn" onClick={openNewTab}>
            Preview the new tab page
          </button>
          <button type="button" className="btn ghost" onClick={() => void chrome.runtime.openOptionsPage()}>
            Settings
          </button>
        </div>
      </section>

      <section className="card">
        <h2>New tab page</h2>
        <p className="lead">
          {newTab
            ? 'Your new tab page is already the Safari start page.'
            : 'Chrome only lets an extension take over the new tab page through its manifest, so this is a one-command switch:'}
        </p>
        {!newTab && (
          <>
            <pre
              style={{
                margin: '0 0 12px',
                padding: '11px 13px',
                borderRadius: 12,
                background: 'color-mix(in srgb, currentColor 7%, transparent)',
                fontSize: 12.5,
              }}
            >
              npm run newtab on{'\n'}# then click Reload on chrome://extensions
            </pre>
            <p className="hint">
              Prefer your own homepage? Skip it — the popup and every shortcut work on any page either way.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>What the start page looks like</h2>
        <p className="lead">Squircle tiles, vibrancy glass, real Apple wallpapers and spring transitions.</p>
        <div className="tile-preview" aria-hidden>
          <i>🍎</i>
          <i>☁️</i>
          <i>📰</i>
          <i>💻</i>
          <i style={{ opacity: 0.6 }}>＋</i>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={openHost}>
            See it for real
          </button>
        </div>
      </section>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing in welcome.html');

createRoot(container).render(
  <StrictMode>
    <Welcome />
  </StrictMode>,
);
