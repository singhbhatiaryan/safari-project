/**
 * Wallpaper bytes live in IndexedDB (Blobs), never in localStorage/chrome.storage,
 * so a 20 MB desktop wallpaper does not blow the 5 MB / 10 MB quotas.
 * Only lightweight metadata travels in the store.
 */
import { CustomWallpaper } from './types';

const DB_NAME = 'safari-startpage';
const DB_VERSION = 1;
const FILE_STORE = 'wallpapers';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(FILE_STORE, mode);
      const request = run(transaction.objectStore(FILE_STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putWallpaperFile(id: string, blob: Blob): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(FILE_STORE, 'readwrite');
      transaction.objectStore(FILE_STORE).put(blob, id);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getWallpaperFile(id: string): Promise<Blob | null> {
  const value = await tx<Blob>('readonly', (store) => store.get(id) as IDBRequest<Blob>);
  return value instanceof Blob ? value : null;
}

export async function deleteWallpaperFile(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function listWallpaperIds(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>);
  return (keys || []).map(String);
}

/* ------------------------------------------------------------------ */
/* object-url cache so the renderer never re-reads a 20 MB blob        */
/* ------------------------------------------------------------------ */

const urlCache = new Map<string, string>();

export async function wallpaperObjectUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const blob = await getWallpaperFile(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function releaseWallpaperUrl(id?: string): void {
  if (id) {
    const url = urlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(id);
    return;
  }
  urlCache.forEach((url) => URL.revokeObjectURL(url));
  urlCache.clear();
}

/** Downscales an uploaded image so the grid stays fast and storage stays sane. */
export async function prepareWallpaper(
  file: File,
  maxEdge = 2560,
  quality = 0.86,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await loadBitmap(file);
  if (!bitmap) return { blob: file, width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: file, width: bitmap.width, height: bitmap.height };
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/webp', quality),
  );
  return { blob: blob ?? file, width, height };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    return img;
  } catch {
    return null;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

export function metaForWallpaper(file: File, id: string, width: number, height: number): CustomWallpaper {
  return {
    id,
    name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Custom',
    mime: file.type || 'image/webp',
    width,
    height,
    createdAt: Date.now(),
  };
}
