import { useCallback, useEffect, useState } from 'react';
import { friendlyError } from '../lib/app-store';

/** Wraps an async handler with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<void>, mapError: (e: unknown) => string = friendlyError) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(mapError(e));
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, run, setError };
}

/** Ticks every `ms`; drives TOTP countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
