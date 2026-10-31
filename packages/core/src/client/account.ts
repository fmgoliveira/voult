import {
  changeMasterPassword,
  createAccount,
  deriveLogin,
  unlockAccountKey,
  unlockWithRecovery,
} from '../crypto/keys';
import { DEFAULT_KDF_PARAMS } from '../crypto/kdf';
import { openSnapshotWithKey, snapshotChecksum, type Snapshot } from '../exchange/snapshot';
import { createVault } from '../vault/ops';
import { VaultLockedError, WrongPasswordError } from './errors';
import type { Http } from './http';
import { getAccount, type ClientStore } from './store';
import type { AccountMeta, DeviceInfo } from './types';

/** What the account flows need from the host platform. */
export interface SessionPlatform {
  getAccountKey(): Promise<Uint8Array | null>;
  setAccountKey(key: Uint8Array): Promise<void>;
  clearAccountKey(): Promise<void>;
  /** Hold the recovery secret (memory only) until the user confirms the kit. */
  setPendingRecovery(secret: string): Promise<void>;
  clearPendingRecovery(): Promise<void>;
  /** Drop PIN / biometric material on sign-out. */
  clearQuickUnlock(): Promise<void>;
}

export interface AccountDeps {
  store: ClientStore;
  http: Http;
  session: SessionPlatform;
  device: () => DeviceInfo;
  /** Throws if the URL is not acceptable (e.g. plain http). */
  normalizeServerUrl: (url: string) => string;
  requestSync: () => void;
}

export interface Credentials {
  email: string;
  password: string;
  serverUrl: string;
}

interface LoginResponse {
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  account: Pick<AccountMeta, 'kdfParams' | 'salt' | 'wrappedAccountKey' | 'wrappedRecoveryKey'>;
}

export function createAccountService(deps: AccountDeps) {
  const { store, http, session } = deps;

  const hasAccount = async () => (await getAccount(store)) !== undefined;

  /** Create a brand-new account and its first vault, and unlock. */
  async function createNewAccount(c: Credentials): Promise<{ recoverySecret: string }> {
    const serverUrl = deps.normalizeServerUrl(c.serverUrl);
    const created = await createAccount(c.password);
    const m = created.material;
    const res = (await http.publicRequest(serverUrl, 'POST', '/auth/signup', {
      email: c.email,
      authKey: m.authKey,
      kdfParams: m.kdfParams,
      salt: m.salt,
      wrappedAccountKey: m.wrappedAccountKey,
      wrappedRecoveryKey: m.wrappedRecoveryKey,
      device: deps.device(),
    })) as unknown as Pick<
      LoginResponse,
      'userId' | 'deviceId' | 'accessToken' | 'refreshToken' | 'expiresIn'
    >;

    await store.clearAll();
    await store.setMeta('account', {
      email: c.email.trim().toLowerCase(),
      serverUrl,
      userId: res.userId,
      deviceId: res.deviceId,
      kdfParams: m.kdfParams,
      salt: m.salt,
      wrappedAccountKey: m.wrappedAccountKey,
      wrappedRecoveryKey: m.wrappedRecoveryKey,
      recoveryConfirmed: false,
    } satisfies AccountMeta);
    await http.saveTokens(res);
    await session.setAccountKey(created.accountKey);

    const { record } = createVault(created.accountKey, { name: 'Personal' });
    await store.transaction(async () => {
      await store.putVault({ ...record, rev: 0, deletedAt: null, dirty: 1 });
      await store.addOutbox({ kind: 'vault', id: record.id, baseRev: 0 });
    });
    await session.setPendingRecovery(created.recoverySecret);
    deps.requestSync();
    return { recoverySecret: created.recoverySecret };
  }

  /**
   * Recreate an account from a snapshot (a Drive backup or .voult file) on a possibly brand-new
   * server. Needs only the master password: the snapshot carries the salt, KDF parameters and
   * wrapped keys, and every record is queued to upload as-is.
   */
  async function restoreFromSnapshot(
    snapshot: Snapshot,
    c: { password: string; serverUrl: string; email?: string },
  ): Promise<{ counts: { items: number; totp: number; passkeys: number }; checksum: string }> {
    const email = (c.email ?? snapshot.email ?? '').trim();
    if (!email) throw new Error('email_required');
    const serverUrl = deps.normalizeServerUrl(c.serverUrl);
    const { authKey, kek } = await deriveLogin(c.password, snapshot.salt, snapshot.kdfParams);
    let accountKey: Uint8Array;
    try {
      accountKey = unlockAccountKey(kek, snapshot.wrappedAccountKey);
    } catch {
      throw new WrongPasswordError();
    }
    // Decrypting everything first proves the backup is intact before touching the server.
    const { counts } = openSnapshotWithKey(snapshot, accountKey);

    const res = (await http.publicRequest(serverUrl, 'POST', '/auth/signup', {
      email,
      authKey,
      kdfParams: snapshot.kdfParams,
      salt: snapshot.salt,
      wrappedAccountKey: snapshot.wrappedAccountKey,
      wrappedRecoveryKey: snapshot.wrappedRecoveryKey,
      device: deps.device(),
    })) as unknown as Pick<
      LoginResponse,
      'userId' | 'deviceId' | 'accessToken' | 'refreshToken' | 'expiresIn'
    >;

    await store.clearAll();
    await store.setMeta('account', {
      email: email.toLowerCase(),
      serverUrl,
      userId: res.userId,
      deviceId: res.deviceId,
      kdfParams: snapshot.kdfParams,
      salt: snapshot.salt,
      wrappedAccountKey: snapshot.wrappedAccountKey,
      wrappedRecoveryKey: snapshot.wrappedRecoveryKey,
      recoveryConfirmed: true, // the backup came from an account that already has its kit
    } satisfies AccountMeta);
    await http.saveTokens(res);
    await session.setAccountKey(accountKey);

    await store.transaction(async () => {
      for (const v of snapshot.vaults) {
        await store.putVault({
          id: v.id,
          wrappedVaultKey: v.wrappedVaultKey,
          encMeta: v.encMeta,
          rev: 0,
          deletedAt: v.deletedAt,
          dirty: 1,
        });
        await store.addOutbox({ kind: 'vault', id: v.id, baseRev: 0 });
      }
      for (const i of snapshot.items) {
        await store.putItem({
          id: i.id,
          vaultId: i.vaultId,
          type: i.type,
          wrappedItemKey: i.wrappedItemKey,
          ciphertext: i.ciphertext,
          version: i.version,
          rev: 0,
          updatedAt: i.updatedAt,
          deletedAt: i.deletedAt,
          dirty: 1,
        });
        await store.addOutbox({ kind: 'item', id: i.id, baseRev: 0 });
      }
    });
    deps.requestSync();
    return { counts, checksum: snapshotChecksum(snapshot) };
  }

  async function loginRequest(
    serverUrl: string,
    email: string,
    password: string,
    deviceId?: string,
  ) {
    const pre = (await http.publicRequest(
      serverUrl,
      'GET',
      `/auth/prelogin?email=${encodeURIComponent(email)}`,
    )) as { salt: string; kdfParams: AccountMeta['kdfParams'] };
    const { authKey, kek } = await deriveLogin(password, pre.salt, pre.kdfParams);
    let res: LoginResponse;
    try {
      res = (await http.publicRequest(serverUrl, 'POST', '/auth/login', {
        email,
        authKey,
        device: deps.device(),
        deviceId,
      })) as unknown as LoginResponse;
    } catch (e) {
      if ((e as { status?: number })?.status === 401) throw new WrongPasswordError();
      throw e;
    }
    let accountKey: Uint8Array;
    try {
      accountKey = unlockAccountKey(kek, res.account.wrappedAccountKey);
    } catch {
      throw new WrongPasswordError();
    }
    return { res, accountKey };
  }

  /** Sign in on a new device with email + master password. */
  async function signIn(c: Credentials): Promise<void> {
    const serverUrl = deps.normalizeServerUrl(c.serverUrl);
    const { res, accountKey } = await loginRequest(serverUrl, c.email, c.password);
    await store.clearAll();
    await store.setMeta('account', {
      email: c.email.trim().toLowerCase(),
      serverUrl,
      userId: res.userId,
      deviceId: res.deviceId,
      ...res.account,
      recoveryConfirmed: true, // an existing account already went through the recovery kit
    } satisfies AccountMeta);
    await http.saveTokens(res);
    await session.setAccountKey(accountKey);
    deps.requestSync();
  }

  /** Session expired or revoked: sign in again without discarding unsynced local changes. */
  async function reauthenticate(password: string): Promise<void> {
    const a = await getAccount(store);
    if (!a) throw new Error('no_account');
    const { res, accountKey } = await loginRequest(a.serverUrl, a.email, password);
    await store.setMeta('account', { ...a, deviceId: res.deviceId, ...res.account });
    await http.saveTokens(res);
    await session.setAccountKey(accountKey);
    deps.requestSync();
  }

  async function unlockWithPassword(password: string): Promise<void> {
    const a = await getAccount(store);
    if (!a) throw new Error('no_account');
    const { kek } = await deriveLogin(password, a.salt, a.kdfParams);
    let accountKey: Uint8Array;
    try {
      accountKey = unlockAccountKey(kek, a.wrappedAccountKey);
    } catch {
      throw new WrongPasswordError();
    }
    await session.setAccountKey(accountKey);
    deps.requestSync();
  }

  async function unlockWithRecoverySecret(secret: string): Promise<void> {
    const a = await getAccount(store);
    if (!a) throw new Error('no_account');
    let accountKey: Uint8Array;
    try {
      accountKey = unlockWithRecovery(secret, a.wrappedRecoveryKey);
    } catch {
      throw new WrongPasswordError();
    }
    await session.setAccountKey(accountKey);
    deps.requestSync();
  }

  async function changePassword(current: string, next: string): Promise<void> {
    const a = await getAccount(store);
    const accountKey = await session.getAccountKey();
    if (!a || !accountKey) throw new VaultLockedError();
    const cur = await deriveLogin(current, a.salt, a.kdfParams);
    try {
      unlockAccountKey(cur.kek, a.wrappedAccountKey);
    } catch {
      throw new WrongPasswordError();
    }
    const fresh = await changeMasterPassword(accountKey, next, DEFAULT_KDF_PARAMS);
    await http.requestOk('POST', '/auth/change-password', {
      currentAuthKey: cur.authKey,
      ...fresh,
    });
    await store.setMeta('account', { ...a, ...fresh });
  }

  async function confirmRecoveryKit(): Promise<void> {
    const a = await getAccount(store);
    if (a) await store.setMeta('account', { ...a, recoveryConfirmed: true });
    await session.clearPendingRecovery();
  }

  async function signOut(): Promise<void> {
    try {
      await http.requestOk('POST', '/auth/logout');
    } catch {
      /* offline or already revoked: still clear local state */
    }
    await session.clearAccountKey();
    await session.clearQuickUnlock();
    await session.clearPendingRecovery();
    await http.clearTokens();
    await store.clearAll();
  }

  return {
    hasAccount,
    createNewAccount,
    restoreFromSnapshot,
    signIn,
    reauthenticate,
    unlockWithPassword,
    unlockWithRecoverySecret,
    changePassword,
    confirmRecoveryKit,
    signOut,
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
