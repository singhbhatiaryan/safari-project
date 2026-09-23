/**
 * The single source of truth for the start page.
 *
 * Local-first: localStorage is the primary store, IndexedDB holds wallpaper blobs.
 * When the Chrome extension is installed, every local change is pushed through the
 * bridge and the service worker answers with the authoritative merged state — so a
 * tab saved from the popup shows up in an already-open start page within ~50 ms.
 */
import {
  StoreState,
  STORAGE_KEY,
  createDefaultState,
  installSiteBridge,
  mergeStates,
  pushToBridge,
  sanitize,
} from '@safari/shared';

export interface Toast {
  id: string;
  message: string;
  actionLabel?: string;
  action?: () => void;
  /** how long it stays up, used to draw the countdown bar */
  duration?: number;
}

export interface Snapshot {
  state: StoreState;
  connected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  toasts: Toast[];
}

interface MutateOptions {
  /** push onto the undo stack (default true) */
  undoable?: boolean;
  /** tell the extension about it (default true) */
  broadcast?: boolean;
  /** merge rapid-fire edits (sliders, typing) into one undo entry */
  coalesceKey?: string;
}

const UNDO_LIMIT = 60;
const TOAST_MS = 6000;

function readLocal(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState(true);
    return sanitize(JSON.parse(raw));
  } catch {
    return createDefaultState(true);
  }
}

class StartPageStore {
  private state: StoreState;
  private past: StoreState[] = [];
  private future: StoreState[] = [];
  private listeners = new Set<() => void>();
  private connected = false;
  private toasts: Toast[] = [];
  private snapshot: Snapshot;
  private saveTimer: number | null = null;
  private lastCoalesce: { key: string; at: number } | null = null;
  private detachBridge: (() => void) | null = null;
  private toastTimers = new Map<string, number>();

  constructor() {
    this.state = readLocal();
    this.snapshot = this.build();
  }

  /* ---------------- react integration ---------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private build(): Snapshot {
    return {
      state: this.state,
      connected: this.connected,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      toasts: this.toasts,
    };
  }

  private emit(): void {
    this.snapshot = this.build();
    this.listeners.forEach((l) => l());
  }

  /* ---------------- mutation ---------------- */

  mutate(updater: (state: StoreState) => StoreState, opts: MutateOptions = {}): void {
    const { undoable = true, broadcast = true, coalesceKey } = opts;
    const next = updater(this.state);
    if (next === this.state) return;
    this.commit(next, { undoable, broadcast, coalesceKey });
  }

  private commit(next: StoreState, opts: MutateOptions): void {
    const { undoable = true, broadcast = true, coalesceKey } = opts;
    const now = Date.now();
    const coalesce = Boolean(coalesceKey && this.lastCoalesce && this.lastCoalesce.key === coalesceKey && now - this.lastCoalesce.at < 700);
    if (undoable && !coalesce) {
      this.past = [...this.past, this.state].slice(-UNDO_LIMIT);
      this.future = [];
    }
    this.lastCoalesce = coalesceKey ? { key: coalesceKey, at: now } : null;
    this.state = next;
    this.persist();
    this.emit();
    if (broadcast) this.broadcast();
  }

  /** Replaces everything (import, remote merge) without touching the undo stack. */
  replace(next: StoreState, opts: { broadcast?: boolean; undoable?: boolean } = {}): void {
    if (opts.undoable) this.past = [...this.past, this.state].slice(-UNDO_LIMIT);
    this.state = next;
    this.persist();
    this.emit();
    if (opts.broadcast) this.broadcast();
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future = [this.state, ...this.future].slice(0, UNDO_LIMIT);
    this.state = previous;
    this.persist();
    this.emit();
    this.broadcast();
  }

  redo(): void {
    const [next, ...rest] = this.future;
    if (!next) return;
    this.past = [...this.past, this.state].slice(-UNDO_LIMIT);
    this.future = rest;
    this.state = next;
    this.persist();
    this.emit();
    this.broadcast();
  }

  /* ---------------- persistence ---------------- */

  private persist(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (error) {
        this.toast('Storage is full — export a backup and remove some wallpapers.');
        console.warn('[safari-startpage] persist failed', error);
      }
    }, 220);
  }

  private broadcast(): void {
    pushToBridge(this.state);
  }

  /** Writes synchronously — used right before a reload/export. */
  flush(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* ignore */
    }
  }

  /* ---------------- bridge ---------------- */

  connect(): void {
    if (this.detachBridge) return;
    this.detachBridge = installSiteBridge({
      getState: () => this.state,
      applyState: (remote) => this.applyRemote(remote),
      onConnectionChange: (connected) => {
        this.connected = connected;
        this.emit();
      },
    });

    // Same-tab "storage" events fire only for other tabs, but another tab writing
    // localStorage means the extension may be absent — merge defensively.
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        this.applyRemote(sanitize(JSON.parse(event.newValue)));
      } catch {
        /* ignore malformed writes */
      }
    });
  }

  private applyRemote(remote: StoreState): void {
    const merged = mergeStates(this.state, remote);
    if (!merged.changed) return;
    this.state = merged.state;
    this.persist();
    this.emit();
    if (merged.remoteStale) this.broadcast();
  }

  /* ---------------- toasts ---------------- */

  toast(message: string, options: { actionLabel?: string; action?: () => void; duration?: number } = {}): void {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast: Toast = {
      id,
      message,
      actionLabel: options.actionLabel,
      action: options.action,
      duration: options.duration ?? TOAST_MS,
    };
    this.toasts = [...this.toasts, toast];
    this.emit();
    const timer = window.setTimeout(() => this.dismissToast(id), options.duration ?? TOAST_MS);
    this.toastTimers.set(id, timer);
  }

  dismissToast = (id: string): void => {
    const timer = this.toastTimers.get(id);
    if (timer) window.clearTimeout(timer);
    this.toastTimers.delete(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  };

  getState(): StoreState {
    return this.state;
  }
}

export const store = new StartPageStore();
export type { StartPageStore };
