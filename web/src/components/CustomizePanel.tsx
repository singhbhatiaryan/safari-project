import { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  IconStyle,
  LayoutMode,
  SearchEngineId,
  Settings,
  ThemeMode,
  WALLPAPER_PRESETS,
  addCustomWallpaper,
  deleteWallpaperFile,
  metaForWallpaper,
  prepareWallpaper,
  putWallpaperFile,
  releaseWallpaperUrl,
  removeCustomWallpaper,
  setSettings,
  uid,
} from '@safari/shared';
import { store } from '../state/store';
import { useSettings, useStartPage } from '../state/hooks';

const ACCENTS = ['#0A84FF', '#34C759', '#FF9F0A', '#FF375F', '#BF5AF2', '#FFD60A', '#64D2FF', '#8E8E93'];

export function CustomizePanel({
  open,
  onClose,
  onImportExport,
  customUrls,
}: {
  open: boolean;
  onClose: () => void;
  onImportExport: () => void;
  customUrls: Record<string, string>;
}) {
  const settings = useSettings();
  const { connected } = useStartPage();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const set = (patch: Partial<Settings>, coalesceKey?: string) =>
    store.mutate((s) => setSettings(s, patch), { coalesceKey });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      store.toast('That file is not an image.');
      return;
    }
    const { blob, width, height } = await prepareWallpaper(file);
    const id = uid();
    const ok = await putWallpaperFile(id, blob);
    if (!ok) {
      store.toast('Could not store the wallpaper (IndexedDB unavailable).');
      return;
    }
    store.mutate((s) => addCustomWallpaper(s, metaForWallpaper(file, id, width, height)));
    store.toast(`Wallpaper “${file.name}” added.`);
  };

  const removeCustom = async (id: string, name: string) => {
    store.mutate((s) => removeCustomWallpaper(s, id));
    releaseWallpaperUrl(id);
    await deleteWallpaperFile(id);
    store.toast(`Removed “${name}”.`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="customize-panel panel glass-strong"
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          aria-label="Customize start page"
        >
          <div className="flex items-center justify-between">
            <strong style={{ fontSize: 13 }}>Customize</strong>
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close customizer">
              ✕
            </button>
          </div>

          <div className="cp-group">
            <p className="cp-heading">Layout</p>
            <Segmented<LayoutMode>
              value={settings.layout}
              options={[
                { value: 'macos', label: 'Safari Start Page' },
                { value: 'ios', label: 'iOS Home Screen' },
              ]}
              onChange={(value) => set({ layout: value })}
            />
            <div className="cp-row">
              <span>Icon labels</span>
              <Toggle checked={settings.labels} onChange={(v) => set({ labels: v })} label="Icon labels" />
            </div>
            <div className="cp-row">
              <span>Columns</span>
              <Slider
                min={4}
                max={12}
                value={settings.layout === 'macos' ? settings.columnsMac : settings.columnsIos}
                onChange={(v) => set(settings.layout === 'macos' ? { columnsMac: v } : { columnsIos: v }, 'columns')}
              />
            </div>
            {settings.layout === 'ios' && (
              <div className="cp-row">
                <span>Rows per page</span>
                <Slider min={3} max={7} value={settings.rowsIos} onChange={(v) => set({ rowsIos: v }, 'rows')} />
              </div>
            )}
          </div>

          <div className="cp-group">
            <p className="cp-heading">Appearance</p>
            <Segmented<ThemeMode>
              value={settings.theme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'Auto' },
              ]}
              onChange={(value) => set({ theme: value })}
            />
            <div className="cp-row">
              <span>Icons</span>
              <Segmented<IconStyle>
                value={settings.iconStyle}
                options={[
                  { value: 'default', label: 'Color' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'tinted', label: 'Tinted' },
                ]}
                onChange={(value) => set({ iconStyle: value })}
              />
            </div>
            <div className="cp-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
              <span>Accent</span>
              <div className="accent-dots">
                {ACCENTS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="accent-dot"
                    style={{ background: color }}
                    aria-pressed={settings.accent.toLowerCase() === color.toLowerCase()}
                    aria-label={`Accent ${color}`}
                    onClick={() => set({ accent: color })}
                  />
                ))}
              </div>
            </div>
            <div className="cp-row">
              <span>Glass blur</span>
              <Slider min={0} max={44} value={settings.blur} onChange={(v) => set({ blur: v }, 'blur')} />
            </div>
            <div className="cp-row">
              <span>Wallpaper dim</span>
              <Slider min={0} max={70} value={settings.dim} onChange={(v) => set({ dim: v }, 'dim')} />
            </div>
            <div className="cp-row">
              <span>Reduce motion</span>
              <Toggle checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Reduce motion" />
            </div>
          </div>

          <div className="cp-group">
            <p className="cp-heading">Wallpaper</p>
            <div className="wallpaper-grid">
              {WALLPAPER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="wallpaper-swatch"
                  style={{ background: preset.css, backgroundSize: 'cover' }}
                  aria-pressed={settings.wallpaper === `grad:${preset.id}`}
                  title={preset.name}
                  aria-label={preset.name}
                  onClick={() => set({ wallpaper: `grad:${preset.id}` })}
                />
              ))}
              {settings.wallpapers.map((custom) => (
                <button
                  key={custom.id}
                  type="button"
                  className="wallpaper-swatch remove"
                  aria-pressed={settings.wallpaper === `custom:${custom.id}`}
                  title={`${custom.name} — click × to remove`}
                  aria-label={custom.name}
                  style={{
                    background: customUrls[custom.id]
                      ? `url(${customUrls[custom.id]}) center/cover`
                      : 'rgba(120,120,128,0.25)',
                  }}
                  onClick={() => set({ wallpaper: `custom:${custom.id}` })}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void removeCustom(custom.id, custom.name);
                  }}
                />
              ))}
              <button
                type="button"
                className="wallpaper-swatch"
                style={{ display: 'grid', placeItems: 'center', background: 'rgba(120,120,128,0.2)', fontSize: 15 }}
                onClick={() => fileInput.current?.click()}
                aria-label="Upload a wallpaper"
                title="Upload your own wallpaper"
              >
                +
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <p className="hint" style={{ marginTop: 8 }}>
              Custom wallpapers are downscaled to 2560px and stored locally in IndexedDB. Right-click one to delete it.
            </p>
          </div>

          <div className="cp-group">
            <p className="cp-heading">Sections</p>
            <div className="cp-row">
              <span>Favorites</span>
              <Toggle checked={settings.showFavorites} onChange={(v) => set({ showFavorites: v })} label="Favorites" />
            </div>
            <div className="cp-row">
              <span>Search field</span>
              <Toggle checked={settings.showSearch} onChange={(v) => set({ showSearch: v })} label="Search field" />
            </div>
            <div className="cp-row">
              <span>Reading list</span>
              <Toggle
                checked={settings.showReadingList}
                onChange={(v) => set({ showReadingList: v })}
                label="Reading list"
              />
            </div>
            <div className="cp-row">
              <span>Privacy report</span>
              <Toggle
                checked={settings.showPrivacyReport}
                onChange={(v) => set({ showPrivacyReport: v })}
                label="Privacy report"
              />
            </div>
            <div className="cp-row">
              <span>Dock (iOS)</span>
              <Toggle checked={settings.showDock} onChange={(v) => set({ showDock: v })} label="Dock" />
            </div>
            <div className="cp-row">
              <span>Open links in new tab</span>
              <Toggle
                checked={settings.openInNewTab}
                onChange={(v) => set({ openInNewTab: v })}
                label="Open links in new tab"
              />
            </div>
            <div className="cp-row">
              <span>Search engine</span>
              <select
                className="field"
                style={{ width: 140 }}
                value={settings.searchEngine}
                onChange={(event) => set({ searchEngine: event.target.value as SearchEngineId })}
                aria-label="Search engine"
              >
                <option value="google">Google</option>
                <option value="duckduckgo">DuckDuckGo</option>
                <option value="bing">Bing</option>
                <option value="brave">Brave</option>
                <option value="wikipedia">Wikipedia</option>
                <option value="none">None</option>
              </select>
            </div>
            <div className="cp-row">
              <span>Favorites title</span>
              <input
                className="field"
                style={{ width: 140 }}
                value={settings.favoritesTitle}
                onChange={(event) => set({ favoritesTitle: event.target.value }, 'favoritesTitle')}
                aria-label="Favorites heading"
              />
            </div>
          </div>

          <div className="cp-group">
            <p className="cp-heading">Data</p>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn" onClick={onImportExport}>
                Import / Export
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(JSON.stringify(store.getState()))
                    .then(() => store.toast('Store JSON copied to the clipboard.'))
                    .catch(() => store.toast('Clipboard permission denied.'));
                }}
              >
                Copy raw JSON
              </button>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              {connected
                ? 'Extension connected: saves from the popup or a keyboard shortcut sync in within ~50 ms.'
                : 'Install the bundled extension (extension/release) to save any tab with ⌘⇧S and open this page on new tabs.'}
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  );
}

function Slider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      style={{ width: 140 }}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
