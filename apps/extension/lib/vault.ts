import {
  changeMasterPassword,
  createAccount,
  createVault,
  decryptItem,
  deriveLogin,
  encryptItem,
  fromBase64Url,
  hkdfSha256,
  newId,
  toBase64Url,
  unlockAccountKey,
  unlockWithRecovery,
  updateLogin,
  wrapKey,
  unwrapKey,
  randomBytes,
  deriveMasterKey,
  DEFAULT_KDF_PARAMS,
  type Item,
  type LoginItem,
  type VaultMeta,
} from '@voult/core';
import { browser } from 'wxt/browser';
import { clearTokens, publicRequest, requestOk, saveTokens } from './api';
import { db, type AccountMeta } from './db';
import { openVaults } from './keys';
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

export class VaultLockedError extends Error {
  constructor() {
    super('vault_locked');
  }
}
export class WrongPasswordError extends Error {
  constructor() {
    super('wrong_password');
  }
}

const deviceInfo = () => ({
  name: `${navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Chrome'} extension`,
  platform: (navigator.userAgent.includes('Firefox') ? 'firefox' : 'chrome') as
    'firefox' | 'chrome',
});

/** Ask the background worker to sync; harmless if it is not listening. */
export function requestSync(): void {
  browser.runtime.sendMessage({ type: 'sync' }).catch(() => undefined);
}

// ---------------------------------------------------------------- account lifecycle

export async function hasAccount(): Promise<boolean> {
  return (await db.getAccount()) !== undefined;
}

export interface Credentials {
  email: string;
  password: string;
  serverUrl: string;
}

/** Create a brand-new account, its first vault, and unlock. Returns the recovery secret. */
export async function createNewAccount(c: Credentials): Promise<{ recoverySecret: string }> {
  const serverUrl = normalizeServerUrl(c.serverUrl);
  const created = await createAccount(c.password);
  const m = created.material;
  const res = (await publicRequest(serverUrl, 'POST', '/auth/signup', {
    email: c.email,
    authKey: m.authKey,
    kdfParams: m.kdfParams,
    salt: m.salt,
    wrappedAccountKey: m.wrappedAccountKey,
    wrappedRecoveryKey: m.wrappedRecoveryKey,
    device: deviceInfo(),
  })) as {
    userId: string;
    deviceId: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };

  await db.clearAll();
  const account: AccountMeta = {
    email: c.email.trim().toLowerCase(),
    serverUrl,
    userId: res.userId,
    deviceId: res.deviceId,
    kdfParams: m.kdfParams,
    salt: m.salt,
    wrappedAccountKey: m.wrappedAccountKey,
    wrappedRecoveryKey: m.wrappedRecoveryKey,
    recoveryConfirmed: false,
  };
  await db.setMeta('account', account);
  await saveTokens(res);
  await setAccountKey(created.accountKey);

  const { record } = createVault(created.accountKey, { name: 'Personal' });
  await db.transaction('rw', db.vaults, db.outbox, async () => {
    await db.vaults.put({ ...record, rev: 0, deletedAt: null, dirty: 1 });
    await db.outbox.add({ kind: 'vault', id: record.id, baseRev: 0 });
  });
  await setPendingRecovery(created.recoverySecret);
  requestSync();
  return { recoverySecret: created.recoverySecret };
}

/** Sign in on a new device with email + master password. */
export async function signIn(c: Credentials): Promise<void> {
  const serverUrl = normalizeServerUrl(c.serverUrl);
  const pre = (await publicRequest(
    serverUrl,
    'GET',
    `/auth/prelogin?email=${encodeURIComponent(c.email)}`,
  )) as { salt: string; kdfParams: AccountMeta['kdfParams'] };
  const { authKey, kek } = await deriveLogin(c.password, pre.salt, pre.kdfParams);
  const res = (await publicRequest(serverUrl, 'POST', '/auth/login', {
    email: c.email,
    authKey,
    device: deviceInfo(),
  }).catch((e) => {
    if (e?.status === 401) throw new WrongPasswordError();
    throw e;
  })) as {
    userId: string;
    deviceId: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    account: Pick<AccountMeta, 'kdfParams' | 'salt' | 'wrappedAccountKey' | 'wrappedRecoveryKey'>;
  };
  const accountKey = unlockAccountKey(kek, res.account.wrappedAccountKey);
  await db.clearAll();
  await db.setMeta('account', {
    email: c.email.trim().toLowerCase(),
    serverUrl,
    userId: res.userId,
    deviceId: res.deviceId,
    ...res.account,
    recoveryConfirmed: true, // an existing account already went through the recovery kit
  } satisfies AccountMeta);
  await saveTokens(res);
  await setAccountKey(accountKey);
  requestSync();
}

export async function confirmRecoveryKit(): Promise<void> {
  const a = await db.getAccount();
  if (a) await db.setMeta('account', { ...a, recoveryConfirmed: true });
  await clearPendingRecovery();
}

export async function signOut(): Promise<void> {
  try {
    await requestOk('POST', '/auth/logout');
  } catch {
    /* offline or already revoked: still clear local state */
  }
  await clearAccountKey();
  await clearPinBlob();
  await clearPendingRecovery();
  await clearTokens();
  await db.clearAll();
}

// ---------------------------------------------------------------- lock / unlock

export async function lock(): Promise<void> {
  await clearAccountKey();
}

export async function unlockWithPassword(password: string, newPin?: string): Promise<void> {
  const a = await db.getAccount();
  if (!a) throw new Error('no_account');
  const { kek } = await deriveLogin(password, a.salt, a.kdfParams);
  let accountKey: Uint8Array;
  try {
    accountKey = unlockAccountKey(kek, a.wrappedAccountKey);
  } catch {
    throw new WrongPasswordError();
  }
  await setAccountKey(accountKey);
  if (newPin) await setPin(newPin, accountKey);
  else await clearPinBlob();
  requestSync();
}

export async function unlockWithRecoverySecret(secret: string): Promise<void> {
  const a = await db.getAccount();
  if (!a) throw new Error('no_account');
  try {
    await setAccountKey(unlockWithRecovery(secret, a.wrappedRecoveryKey));
  } catch {
    throw new WrongPasswordError();
  }
  requestSync();
}

// PIN: Argon2id(PIN) wraps the account key inside storage.session (memory only).
const PIN_KDF = { m: 19 * 1024, t: 2, p: 1 };
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
  try {
    const key = unwrapKey(
      await pinWrapKey(pin, fromBase64Url(blob.salt)),
      blob.wrappedAccountKey,
      'voult:pin',
    );
    await setAccountKey(key);
    await setPinBlob({ ...blob, attemptsLeft: PIN_MAX_ATTEMPTS });
    requestSync();
    return { ok: true };
  } catch {
    const attemptsLeft = blob.attemptsLeft - 1;
    if (attemptsLeft <= 0) await clearPinBlob();
    else await setPinBlob({ ...blob, attemptsLeft });
    return { ok: false, attemptsLeft: Math.max(attemptsLeft, 0) };
  }
}

export async function changePassword(current: string, next: string): Promise<void> {
  const a = await db.getAccount();
  const accountKey = await getAccountKey();
  if (!a || !accountKey) throw new VaultLockedError();
  const cur = await deriveLogin(current, a.salt, a.kdfParams);
  try {
    unlockAccountKey(cur.kek, a.wrappedAccountKey);
  } catch {
    throw new WrongPasswordError();
  }
  const fresh = await changeMasterPassword(accountKey, next, DEFAULT_KDF_PARAMS);
  await requestOk('POST', '/auth/change-password', { currentAuthKey: cur.authKey, ...fresh });
  await db.setMeta('account', { ...a, ...fresh });
}

// ---------------------------------------------------------------- reading

export interface VaultView {
  id: string;
  meta: VaultMeta;
}
export interface ItemView {
  id: string;
  vaultId: string;
  item: Item;
  deletedAt: number | null;
  dirty: boolean;
}

export async function loadVault(): Promise<{ vaults: VaultView[]; items: ItemView[] }> {
  const accountKey = await getAccountKey();
  if (!accountKey) throw new VaultLockedError();
  const vaults = await openVaults(accountKey);
  const items: ItemView[] = [];
  for (const r of await db.items.toArray()) {
    const v = vaults.get(r.vaultId);
    if (!v) continue;
    try {
      items.push({
        id: r.id,
        vaultId: r.vaultId,
        item: decryptItem(v.vaultKey, r.id, r.version, r),
        deletedAt: r.deletedAt,
        dirty: r.dirty === 1,
      });
    } catch {
      /* undecryptable record: skip rather than crash the list */
    }
  }
  return {
    vaults: [...vaults.values()]
      .filter((v) => !v.deletedAt)
      .map((v) => ({ id: v.id, meta: v.meta })),
    items,
  };
}

// ---------------------------------------------------------------- writing

async function writeItem(
  id: string,
  vaultId: string,
  item: Item,
  deletedAt: number | null,
): Promise<void> {
  const account = await db.getAccount();
  if (account && !account.recoveryConfirmed) throw new Error('recovery_kit_required');
  const accountKey = await getAccountKey();
  if (!accountKey) throw new VaultLockedError();
  const vault = (await openVaults(accountKey)).get(vaultId);
  if (!vault) throw new Error('unknown_vault');

  await db.transaction('rw', db.items, db.outbox, async () => {
    const prev = await db.items.get(id);
    const version = (prev?.version ?? 0) + 1;
    const enc = encryptItem(vault.vaultKey, id, version, item);
    await db.items.put({
      id,
      vaultId,
      type: item.type,
      ...enc,
      version,
      rev: prev?.rev ?? 0,
      updatedAt: item.updatedAt,
      deletedAt,
      dirty: 1,
    });
    if (!(await db.outbox.where({ kind: 'item', id }).first())) {
      await db.outbox.add({ kind: 'item', id, baseRev: prev?.rev ?? 0 });
    }
  });
  requestSync();
}

export async function saveItem(vaultId: string, item: Item, id: string = newId()): Promise<string> {
  await writeItem(id, vaultId, { ...item, updatedAt: Date.now() }, null);
  return id;
}

/** Edit a login, keeping password history. */
export async function saveLoginEdit(view: ItemView, patch: Partial<LoginItem>): Promise<void> {
  if (view.item.type !== 'login') throw new Error('not_a_login');
  const next = updateLogin(view.item, patch, Date.now());
  await writeItem(view.id, view.vaultId, next, view.deletedAt);
}

export async function trashItem(view: ItemView): Promise<void> {
  const now = Date.now();
  await writeItem(view.id, view.vaultId, { ...view.item, updatedAt: now }, now);
}
export async function restoreItem(view: ItemView): Promise<void> {
  await writeItem(view.id, view.vaultId, { ...view.item, updatedAt: Date.now() }, null);
}
/** Marks the item as trashed long ago so every device (and the server job) purges it. */
export async function purgeItem(view: ItemView): Promise<void> {
  await writeItem(view.id, view.vaultId, { ...view.item, updatedAt: Date.now() }, 1);
}

/** Session expired or revoked: sign in again without discarding unsynced local changes. */
export async function reauthenticate(password: string): Promise<void> {
  const a = await db.getAccount();
  if (!a) throw new Error('no_account');
  const pre = (await publicRequest(
    a.serverUrl,
    'GET',
    `/auth/prelogin?email=${encodeURIComponent(a.email)}`,
  )) as {
    salt: string;
    kdfParams: AccountMeta['kdfParams'];
  };
  const { authKey, kek } = await deriveLogin(password, pre.salt, pre.kdfParams);
  const res = (await publicRequest(a.serverUrl, 'POST', '/auth/login', {
    email: a.email,
    authKey,
    device: deviceInfo(),
  }).catch((e) => {
    if (e?.status === 401) throw new WrongPasswordError();
    throw e;
  })) as {
    userId: string;
    deviceId: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    account: Pick<AccountMeta, 'kdfParams' | 'salt' | 'wrappedAccountKey' | 'wrappedRecoveryKey'>;
  };
  const accountKey = unlockAccountKey(kek, res.account.wrappedAccountKey);
  await db.setMeta('account', { ...a, deviceId: res.deviceId, ...res.account });
  await saveTokens(res);
  await setAccountKey(accountKey);
  requestSync();
}
