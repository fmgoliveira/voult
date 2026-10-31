import { fromBase64Url, toBase64Url } from '@voult/core';
import { browser } from 'wxt/browser';

/**
 * Secrets live only in storage.session: memory-backed, cleared when the browser closes, and
 * not exposed to content scripts (default access level) — see NFR4.
 */
const area = () => browser.storage.session;

export async function getAccountKey(): Promise<Uint8Array | null> {
  const r = await area().get('accountKey');
  return typeof r.accountKey === 'string' ? fromBase64Url(r.accountKey) : null;
}

export async function setAccountKey(key: Uint8Array): Promise<void> {
  await area().set({ accountKey: toBase64Url(key), lastActivity: Date.now() });
}

export async function clearAccountKey(): Promise<void> {
  await area().remove(['accountKey']);
}

export const isUnlocked = async (): Promise<boolean> => (await getAccountKey()) !== null;

export async function touchActivity(): Promise<void> {
  try {
    await area().set({ lastActivity: Date.now() });
  } catch {
    /* extension frames inside web pages (Firefox) have no storage.session */
  }
}

export async function getLastActivity(): Promise<number> {
  const r = await area().get('lastActivity');
  return typeof r.lastActivity === 'number' ? r.lastActivity : 0;
}

/** Idle auto-lock decision. `minutes === 0` disables idle locking. */
export function shouldAutoLock(now: number, lastActivity: number, minutes: number): boolean {
  return minutes > 0 && now - lastActivity >= minutes * 60_000;
}

// --- Optional quick-unlock PIN: Argon2id(PIN) wraps the account key. ---
// Kept in storage.local so it survives browser restarts. That is weaker than memory-only: a
// 6-digit PIN can be brute-forced offline by someone who copies the browser profile, which is why
// the PIN's Argon2id cost is high and wrong guesses in the app delete it after PIN_MAX_ATTEMPTS.

export interface PinBlob {
  salt: string;
  wrappedAccountKey: string;
  attemptsLeft: number;
}

export const PIN_MAX_ATTEMPTS = 5;

const pinArea = () => browser.storage.local;
const PIN_KEY = 'quickUnlockPin';

export async function getPinBlob(): Promise<PinBlob | null> {
  const r = await pinArea().get(PIN_KEY);
  return (r[PIN_KEY] as PinBlob | undefined) ?? null;
}
export async function setPinBlob(blob: PinBlob): Promise<void> {
  await pinArea().set({ [PIN_KEY]: blob });
}
export async function clearPinBlob(): Promise<void> {
  await pinArea().remove([PIN_KEY]);
}

// The recovery secret is shown once; keep it (memory only) until the user confirms the kit.
export async function getPendingRecovery(): Promise<string | null> {
  const r = await area().get('pendingRecovery');
  return typeof r.pendingRecovery === 'string' ? r.pendingRecovery : null;
}
export const setPendingRecovery = (s: string) => area().set({ pendingRecovery: s });
export const clearPendingRecovery = () => area().remove(['pendingRecovery']);
