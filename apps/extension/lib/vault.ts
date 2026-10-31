import {
  VaultLockedError,
  WrongPasswordError,
  createAccountService,
  createVaultClient,
  deriveMasterKey,
  fromBase64Url,
  hkdfSha256,
  randomBytes,
  toBase64Url,
  unwrapKey,
  wrapKey,
} from '@voult/core';
import { browser } from 'wxt/browser';
import { http } from './api';
import { store } from './db';
import {
  clearAccountKey,
  clearPendingRecovery,
  clearPinBlob,
  getAccountKey,
  getPinBlob,
  PIN_MAX_ATTEMPTS,
  setAccountKey,
  setPendingRecovery,
  setPinBlob,
} from './session';
import { normalizeServerUrl } from './settings';

export { VaultLockedError, WrongPasswordError };
export type { Credentials, ItemView, VaultView } from '@voult/core';

/** Ask the background worker to sync; harmless if it is not listening. */
export function requestSync(): void {
  browser.runtime.sendMessage({ type: 'sync' }).catch(() => undefined);
}

const isFirefox = () => navigator.userAgent.includes('Firefox');

const accounts = createAccountService({
  store,
  http,
  session: {
    getAccountKey,
    setAccountKey,
    clearAccountKey,
    setPendingRecovery,
    clearPendingRecovery,
    clearQuickUnlock: clearPinBlob,
  },
  device: () => ({
    name: `${isFirefox() ? 'Firefox' : 'Chrome'} extension`,
    platform: isFirefox() ? 'firefox' : 'chrome',
  }),
  normalizeServerUrl,
  requestSync,
});

const vault = createVaultClient({ store, getAccountKey, requestSync });

export const {
  hasAccount,
  createNewAccount,
  signIn,
  reauthenticate,
  unlockWithRecoverySecret,
  changePassword,
  confirmRecoveryKit,
  signOut,
} = accounts;

export const { loadVault, saveItem, saveLoginEdit, trashItem, restoreItem, purgeItem } = vault;

// ---------------------------------------------------------------- lock / unlock

export async function lock(): Promise<void> {
  await clearAccountKey();
}

export async function unlockWithPassword(password: string): Promise<void> {
  // An existing PIN stays valid: it wraps the same account key, which a password unlock does not change.
  await accounts.unlockWithPassword(password);
}

// PIN: Argon2id(PIN) wraps the account key (persisted in storage.local). Costly on purpose: a
// 6-digit PIN has only a million values, so each guess has to be slow for anyone who copies the profile.
const PIN_KDF = { m: 64 * 1024, t: 3, p: 1 };
const pinWrapKey = async (pin: string, salt: Uint8Array) =>
  hkdfSha256(await deriveMasterKey(pin, salt, PIN_KDF), 'pin');

export async function setPin(pin: string, accountKey?: Uint8Array): Promise<void> {
  const key = accountKey ?? (await getAccountKey());
  if (!key) throw new VaultLockedError();
  const salt = randomBytes(16);
  await setPinBlob({
    salt: toBase64Url(salt),
    wrappedAccountKey: wrapKey(await pinWrapKey(pin, salt), key, 'voult:pin'),
    attemptsLeft: PIN_MAX_ATTEMPTS,
  });
}

export const hasPin = async (): Promise<boolean> => (await getPinBlob()) !== null;

/** Returns attempts left on failure; throws nothing for a wrong PIN. 0 left = PIN destroyed. */
export async function unlockWithPin(
  pin: string,
): Promise<{ ok: true } | { ok: false; attemptsLeft: number }> {
  const blob = await getPinBlob();
  if (!blob) return { ok: false, attemptsLeft: 0 };
  // Deriving the key can fail for reasons that have nothing to do with the PIN (memory, wasm);
  // only a failed unwrap means "wrong PIN", so those other failures must not burn an attempt.
  const wrapKeyFromPin = await pinWrapKey(pin, fromBase64Url(blob.salt));
  let key: Uint8Array;
  try {
    key = unwrapKey(wrapKeyFromPin, blob.wrappedAccountKey, 'voult:pin');
  } catch {
    const attemptsLeft = blob.attemptsLeft - 1;
    if (attemptsLeft <= 0) await clearPinBlob();
    else await setPinBlob({ ...blob, attemptsLeft });
    return { ok: false, attemptsLeft: Math.max(attemptsLeft, 0) };
  }
  await setAccountKey(key);
  await setPinBlob({ ...blob, attemptsLeft: PIN_MAX_ATTEMPTS });
  requestSync();
  return { ok: true };
}
