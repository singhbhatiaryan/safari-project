/**
 * Wallpaper catalogue. Presets are pure CSS gradients — they ship instantly, need
 * no assets, look identical in the site, the popup and the new-tab page, and add
 * 0 KB to the repo.
 */
export interface WallpaperPreset {
  id: string;
  name: string;
  /** 'dark' = the wallpaper is dark, so tiles/labels should default to light-on-dark */
  scheme: 'light' | 'dark';
  css: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'sequoia',
    name: 'Sequoia',
    scheme: 'dark',
    css: 'radial-gradient(120% 120% at 12% 6%, #7fd4ff 0%, rgba(127,212,255,0) 52%), radial-gradient(100% 100% at 88% 92%, #0a7d6b 0%, rgba(10,125,107,0) 55%), linear-gradient(195deg, #0b3d91 0%, #113a6b 42%, #061a34 100%)',
  },
  {
    id: 'sonoma',
    name: 'Sonoma',
    scheme: 'dark',
    css: 'radial-gradient(95% 85% at 18% 96%, #ff7a45 0%, rgba(255,122,69,0) 58%), radial-gradient(80% 70% at 82% 12%, #b06bff 0%, rgba(176,107,255,0) 60%), linear-gradient(200deg, #2b1055 0%, #6c2bd9 44%, #ff8a65 100%)',
  },
  {
    id: 'ventura',
    name: 'Ventura',
    scheme: 'dark',
    css: 'radial-gradient(90% 80% at 80% 14%, #ff3b7f 0%, rgba(255,59,127,0) 55%), radial-gradient(85% 75% at 8% 92%, #34c8ff 0%, rgba(52,200,255,0) 58%), linear-gradient(160deg, #1b1145 0%, #3b1e7a 55%, #0e0a24 100%)',
  },
  {
    id: 'bigsur',
    name: 'Big Sur',
    scheme: 'dark',
    css: 'radial-gradient(120% 100% at 50% 112%, #ffc46b 0%, rgba(255,196,107,0) 58%), linear-gradient(180deg, #ff5e7e 0%, #b33a8c 46%, #35215c 100%)',
  },
  {
    id: 'monterey',
    name: 'Monterey',
    scheme: 'dark',
    css: 'radial-gradient(110% 90% at 50% 110%, #1f6feb 0%, rgba(31,111,235,0) 60%), linear-gradient(170deg, #1b2a6b 0%, #0a1233 58%, #04060f 100%)',
  },
  {
    id: 'tahoe',
    name: 'Tahoe',
    scheme: 'light',
    css: 'linear-gradient(180deg, #d6ecff 0%, #9dc9f2 38%, #5f9fd8 68%, #2f6fa8 100%)',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    scheme: 'dark',
    css: 'radial-gradient(80% 70% at 20% 20%, #56f2c0 0%, rgba(86,242,192,0) 55%), radial-gradient(70% 60% at 85% 75%, #7a5cff 0%, rgba(122,92,255,0) 58%), linear-gradient(160deg, #04182c 0%, #072542 60%, #030b16 100%)',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    scheme: 'dark',
    css: 'radial-gradient(100% 90% at 10% 100%, #ffb347 0%, rgba(255,179,71,0) 55%), linear-gradient(190deg, #2d1b4e 0%, #8e3b78 48%, #ff6f61 100%)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    scheme: 'dark',
    css: 'radial-gradient(120% 100% at 50% 0%, #3a3f47 0%, rgba(58,63,71,0) 60%), linear-gradient(180deg, #22262c 0%, #14171b 60%, #0b0d10 100%)',
  },
  {
    id: 'paper',
    name: 'Paper',
    scheme: 'light',
    css: 'radial-gradient(120% 110% at 15% 0%, #ffffff 0%, rgba(255,255,255,0) 55%), linear-gradient(180deg, #f4f6f9 0%, #e6eaf1 55%, #d6dde8 100%)',
  },
  {
    id: 'dawn',
    name: 'Dawn',
    scheme: 'dark',
    css: 'radial-gradient(110% 90% at 22% 108%, #ffd08a 0%, rgba(255,208,138,0) 58%), radial-gradient(90% 80% at 88% 8%, #6d5cff 0%, rgba(109,92,255,0) 62%), linear-gradient(175deg, #ff9a76 0%, #d76a9a 34%, #4a3c8c 72%, #1a1740 100%)',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    scheme: 'dark',
    css: 'radial-gradient(100% 80% at 50% -10%, #cdf3ff 0%, rgba(205,243,255,0) 45%), linear-gradient(180deg, #1a9bd7 0%, #0f5f96 45%, #062b4a 100%)',
  },
];

export function presetById(id: string): WallpaperPreset | undefined {
  return WALLPAPER_PRESETS.find((w) => w.id === id);
}

export interface ResolvedWallpaper {
  id: string;
  name: string;
  scheme: 'light' | 'dark';
  css: string;
}

/**
 * Turns a store wallpaper reference into something a <div> can render.
 * `customUrls` maps custom wallpaper ids to IndexedDB object urls.
 */
export function resolveWallpaper(
  ref: string,
  customUrls: Record<string, string> = {},
): ResolvedWallpaper {
  const [kind, id] = ref.split(':');
  if (kind === 'custom') {
    const url = customUrls[id];
    if (url) return { id, name: 'Custom', scheme: 'dark', css: `center/cover no-repeat url("${url}")` };
    return resolvedFallback();
  }
  if (kind === 'img') {
    const preset = presetById(id);
    return preset
      ? { id, name: preset.name, scheme: preset.scheme, css: preset.css }
      : resolvedFallback();
  }
  const preset = presetById(id) ?? WALLPAPER_PRESETS[0];
  return { id: preset.id, name: preset.name, scheme: preset.scheme, css: preset.css };
}

function resolvedFallback(): ResolvedWallpaper {
  const preset = presetById('dawn')!;
  return { id: preset.id, name: preset.name, scheme: preset.scheme, css: preset.css };
}
