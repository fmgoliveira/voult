import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { hasTokens } from './api';
import { db } from './db';
import { getAccountKey, getPendingRecovery, touchActivity } from './session';
import { getSettings, watchSettings, type Settings } from './settings';
import { hasPin, loadVault, type ItemView, type VaultView } from './vault';

export interface Status {
  hasAccount: boolean;
  unlocked: boolean;
  signedIn: boolean;
  recoveryConfirmed: boolean;
  pin: boolean;
  email: string;
  serverUrl: string;
  pendingRecovery: string | null;
}

/** Re-runs `fn` whenever any extension storage area changes. */
function useStorageTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    browser.storage.onChanged.addListener(l);
    return () => browser.storage.onChanged.removeListener(l);
  }, []);
  return tick;
}

export function useStatus(): Status | null {
  const tick = useStorageTick();
  const account = useLiveQuery(async () => (await db.getAccount()) ?? null, []);
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    if (account === undefined) return;
    void (async () => {
      setStatus({
        hasAccount: account !== null,
        unlocked: (await getAccountKey()) !== null,
        signedIn: await hasTokens(),
        recoveryConfirmed: account?.recoveryConfirmed ?? false,
        pin: await hasPin(),
        email: account?.email ?? '',
        serverUrl: account?.serverUrl ?? '',
        pendingRecovery: await getPendingRecovery(),
      });
    })();
  }, [account, tick]);
  return status;
}

export function useVaultData(enabled: boolean): { vaults: VaultView[]; items: ItemView[] } | null {
  const signature = useLiveQuery(async () => {
    const [items, vaults] = await Promise.all([db.items.toArray(), db.vaults.toArray()]);
    return (
      items.map((i) => `${i.id}:${i.version}:${i.rev}:${i.dirty}:${i.deletedAt}`).join('|') +
      '#' +
      vaults.map((v) => `${v.id}:${v.rev}:${v.encMeta.length}`).join('|')
    );
  }, []);
  const [data, setData] = useState<{ vaults: VaultView[]; items: ItemView[] } | null>(null);
  useEffect(() => {
    if (!enabled || signature === undefined) {
      if (!enabled) setData(null);
      return;
    }
    loadVault()
      .then(setData)
      .catch(() => setData(null));
  }, [enabled, signature]);
  return data;
}

export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    void getSettings().then(setS);
    return watchSettings(setS);
  }, []);
  return s;
}

/** Keeps the idle timer fresh while the popup is being used, and applies the colour theme. */
export function useActivityAndTheme(theme: Settings['theme'] | undefined): void {
  useEffect(() => {
    const ping = () => void touchActivity();
    window.addEventListener('pointerdown', ping);
    window.addEventListener('keydown', ping);
    return () => {
      window.removeEventListener('pointerdown', ping);
      window.removeEventListener('keydown', ping);
    };
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme !== 'light' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Ticks every second; drives TOTP countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>, onError?: (e: unknown) => string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(onError ? onError(e) : e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
