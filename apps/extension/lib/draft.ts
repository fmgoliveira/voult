import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

/**
 * The popup is destroyed whenever it loses focus, so half-typed forms vanish. Drafts are kept in
 * storage.session: memory-only, cleared when the browser closes, and not readable by content
 * scripts (same guarantees as the account key). They also expire after a short idle time.
 */
const PREFIX = 'draft:';
const TTL_MS = 10 * 60_000;

interface Stored<T> {
  v: T;
  at: number;
}

const area = () => browser.storage.session;

export async function clearDrafts(prefix = ''): Promise<void> {
  try {
    const all = await area().get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX + prefix));
    if (keys.length) await area().remove(keys);
  } catch {
    /* no storage.session (extension frames inside web pages on Firefox) */
  }
}

/** `useState` whose value survives the popup closing. `clear()` drops the saved copy. */
export function useDraft<T>(key: string, initial: T | (() => T)) {
  const storageKey = PREFIX + key;
  const [value, setValue] = useState<T>(initial);
  const touched = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await area().get(storageKey);
        const s = r[storageKey] as Stored<T> | undefined;
        if (!live || touched.current || !s) return;
        if (Date.now() - s.at > TTL_MS) await area().remove(storageKey);
        else setValue(s.v);
      } catch {
        /* unavailable: behaves like plain useState */
      } finally {
        if (live) setHydrated(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [storageKey]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      touched.current = true;
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        void area()
          .set({ [storageKey]: { v, at: Date.now() } satisfies Stored<T> })
          .catch(() => undefined);
        return v;
      });
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    touched.current = true;
    void area()
      .remove(storageKey)
      .catch(() => undefined);
  }, [storageKey]);

  return [value, set, clear, hydrated] as const;
}
