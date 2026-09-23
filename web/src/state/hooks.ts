import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Item, Settings, StoreState, childrenOf, liveItems, itemById } from '@safari/shared';
import { Snapshot, store } from './store';

export function useStartPage(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useItems(): Item[] {
  const { state } = useStartPage();
  return useMemo(() => liveItems(state.items), [state.items]);
}

export function useSettings(): Settings {
  const { state } = useStartPage();
  return state.settings;
}

export function useChildren(parentId: string | null): Item[] {
  const { state } = useStartPage();
  return useMemo(() => childrenOf(state.items, parentId), [state.items, parentId]);
}

export function useItem(id: string | null): Item | undefined {
  const { state } = useStartPage();
  return useMemo(() => itemById(state.items, id), [state.items, id]);
}

/** Debounced, layout-independent element size — used for responsive grids. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** True while the pointer is a coarse/touch input. */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false,
  );
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const handler = () => setTouch(query.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return touch;
}

/** Fires `callback` after the pointer rests on something for `delay` ms. */
export function useDwell(delay = 420): {
  target: string | null;
  setTarget: (id: string | null) => void;
  reset: () => void;
} {
  const [target, setTargetState] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const setTarget = useCallback(
    (id: string | null) => {
      clear();
      setTargetState(null);
      if (!id) return;
      timer.current = window.setTimeout(() => setTargetState(id), delay);
    },
    [clear, delay],
  );
  const reset = useCallback(() => {
    clear();
    setTargetState(null);
  }, [clear]);
  useEffect(() => clear, [clear]);
  return { target, setTarget, reset };
}

/** Resolves `system` against the OS preference. */
export function useSystemTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setTheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return theme;
}

/** Snapshot helper for selectors that need the whole state. */
export function useSelector<T>(selector: (state: StoreState) => T, equals: (a: T, b: T) => boolean = Object.is): T {
  const { state } = useStartPage();
  const ref = useRef<T>(selector(state));
  const next = selector(state);
  if (!equals(ref.current, next)) ref.current = next;
  return ref.current;
}
