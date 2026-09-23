/**
 * Site-side half of the extension bridge.
 *
 * Normal website  → talks to the content-script bridge with CustomEvents.
 * Extension page  → talks to the service worker directly with chrome.runtime.
 *
 * Either way the contract is the same: "here is my state" / "here is the
 * authoritative state". If the extension is absent, callers never notice: a
 * missing bridge is simply "no remote state".
 */
import {
  BRIDGE_EVENTS,
  BRIDGE_MESSAGES,
  BRIDGE_VERSION,
  SITE_MARKER,
  type StoreState,
} from './types';

export interface BridgeHandlers {
  /** current local state, read on demand when the extension asks for it */
  getState: () => StoreState;
  /** authoritative state arrived from the extension */
  applyState: (state: StoreState) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface SafariBridgeApi {
  version: number;
  marker: typeof SITE_MARKER;
  push: (state: StoreState) => void;
  requestSync: () => void;
}

interface ChromeLike {
  runtime?: {
    id?: string;
    lastError?: unknown;
    sendMessage?: (message: unknown, callback?: (reply: any) => void) => void;
    onMessage?: {
      addListener: (listener: (message: any) => void) => void;
      removeListener: (listener: (message: any) => void) => void;
    };
  };
}

declare global {
  interface Window {
    __SAFARI_START__?: SafariBridgeApi;
    __safariStartPageMarker?: string;
  }
}

/**
 * Reads `chrome.runtime` without augmenting the global `Window` type: the
 * extension side already has @types/chrome, and two declarations of `chrome`
 * would clash. On a plain website this is simply undefined.
 */
function chromeRuntime(): ChromeLike['runtime'] | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = window as unknown as { chrome?: ChromeLike };
  return host.chrome?.runtime;
}

/** True when this document runs on an extension origin (popup / new-tab page). */
export function hasExtensionRuntime(): boolean {
  return Boolean(chromeRuntime()?.id);
}

function runtimeSend(message: unknown, onReply?: (reply: any) => void): void {
  const runtime = chromeRuntime();
  if (!runtime?.sendMessage) return;
  try {
    runtime.sendMessage(message, (reply) => {
      // Touch lastError so Chrome does not log "Unchecked runtime.lastError".
      void runtime.lastError;
      onReply?.(reply);
    });
  } catch {
    /* the extension context went away mid-flight */
  }
}

export function installSiteBridge(handlers: BridgeHandlers): () => void {
  const inExtensionPage = hasExtensionRuntime();
  let connected = false;

  const setConnected = (next: boolean) => {
    if (connected === next) return;
    connected = next;
    handlers.onConnectionChange?.(next);
  };

  const push = (state: StoreState) => {
    if (inExtensionPage) {
      runtimeSend({ type: BRIDGE_MESSAGES.PUSH, state });
      return;
    }
    window.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.LOCAL_CHANGE, { detail: { state } }));
  };

  const requestSync = () => {
    if (inExtensionPage) {
      runtimeSend({ type: BRIDGE_MESSAGES.HELLO }, (reply: { state?: StoreState } | undefined) => {
        setConnected(true);
        if (reply?.state) handlers.applyState(reply.state);
      });
      return;
    }
    window.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.SYNC_REQUEST));
  };

  const api: SafariBridgeApi = {
    version: BRIDGE_VERSION,
    marker: SITE_MARKER,
    push,
    requestSync,
  };

  // --- website path (content script relays through the worker) ----------
  const onExternal = (event: Event) => {
    const state = (event as CustomEvent<{ state?: StoreState }>).detail?.state;
    setConnected(true);
    if (state) handlers.applyState(state);
  };
  const onReady = () => setConnected(true);

  // --- extension-page path (direct runtime messaging) -------------------
  const onRuntimeMessage = (message: any) => {
    if (message?.type === BRIDGE_MESSAGES.APPLY && message.state) {
      setConnected(true);
      handlers.applyState(message.state as StoreState);
    }
  };

  window.addEventListener(BRIDGE_EVENTS.EXTERNAL_CHANGE, onExternal);
  window.addEventListener(BRIDGE_EVENTS.BRIDGE_READY, onReady);
  window.__SAFARI_START__ = api;

  if (inExtensionPage) {
    const runtime = chromeRuntime();
    runtime?.onMessage?.addListener(onRuntimeMessage);
    requestSync();
    const fallback = window.setTimeout(() => setConnected(true), 1200);
    return () => {
      window.clearTimeout(fallback);
      runtime?.onMessage?.removeListener(onRuntimeMessage);
      window.removeEventListener(BRIDGE_EVENTS.EXTERNAL_CHANGE, onExternal);
      window.removeEventListener(BRIDGE_EVENTS.BRIDGE_READY, onReady);
      delete window.__SAFARI_START__;
    };
  }

  // On a plain website the content script announces itself; give it a moment
  // before we tell the UI "extension not detected" (avoids a wrong flash).
  const grace = window.setTimeout(() => setConnected(false), 900);
  return () => {
    window.clearTimeout(grace);
    window.removeEventListener(BRIDGE_EVENTS.EXTERNAL_CHANGE, onExternal);
    window.removeEventListener(BRIDGE_EVENTS.BRIDGE_READY, onReady);
    delete window.__SAFARI_START__;
  };
}

/** Asks the extension for the authoritative state, on either transport. */
export function requestBridgeSync(): void {
  if (typeof window === 'undefined') return;
  if (window.__SAFARI_START__) {
    window.__SAFARI_START__.requestSync();
    return;
  }
  if (hasExtensionRuntime()) {
    runtimeSend({ type: BRIDGE_MESSAGES.HELLO });
    return;
  }
  window.dispatchEvent(new CustomEvent(BRIDGE_EVENTS.SYNC_REQUEST));
}

/** Notifies the worker that a local change should be merged + echoed back. */
export function pushToBridge(state: StoreState): void {
  if (typeof window === 'undefined') return;
  if (window.__SAFARI_START__) {
    window.__SAFARI_START__.push(state);
    return;
  }
  if (hasExtensionRuntime()) {
    runtimeSend({ type: BRIDGE_MESSAGES.PUSH, state });
  }
}
