import '../polyfills';
import {
  SignedOutError,
  createAccountService,
  createHttp,
  createMutexLock,
  createSyncEngine,
  createVaultClient,
  normalizeServerUrl,
  setArgon2Implementation,
  type AccessToken,
  type RefreshCredentials,
  type SessionPlatform,
  type SyncResult,
  type TokenStore,
} from '@voult/core';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import * as Native from '../../modules/voult-native';
import { SqliteStore, type SqlDb } from '../store/sqlite-store';
import { createQuickUnlock, type KeyValue } from './quick-unlock';
import { DEFAULT_SETTINGS, type Settings } from './settings';

// Hermes has no WebAssembly: Argon2id runs natively.
setArgon2Implementation(Native.nativeArgon2id);

const secureKv: KeyValue = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

export interface Runtime {
  store: SqliteStore;
  http: ReturnType<typeof createHttp>;
  accounts: ReturnType<typeof createAccountService>;
  vault: ReturnType<typeof createVaultClient>;
  quick: ReturnType<typeof createQuickUnlock>;
  /** In-memory unlocked account key. */
  getAccountKey(): Promise<Uint8Array | null>;
  setAccountKey(key: Uint8Array): Promise<void>;
  clearAccountKey(): Promise<void>;
  getPendingRecovery(): string | null;
  syncOnce(): Promise<SyncResult>;
  settings: { get(): Promise<Settings>; update(patch: Partial<Settings>): Promise<Settings> };
}

let instance: Promise<Runtime> | null = null;
/** Callbacks used by the app store; set once at startup. */
export const hooks: { onRequestSync: () => void } = { onRequestSync: () => undefined };

export function getRuntime(): Promise<Runtime> {
  instance ??= create();
  return instance;
}

async function create(): Promise<Runtime> {
  const db = await SQLite.openDatabaseAsync('voult.db');
  const store = await SqliteStore.open(db as unknown as SqlDb);
  const lock = createMutexLock();

  let access: AccessToken | null = null;
  const REFRESH_KEY = 'voult.refresh';
  const tokens: TokenStore = {
    async getRefresh() {
      const raw = await SecureStore.getItemAsync(REFRESH_KEY);
      return raw ? (JSON.parse(raw) as RefreshCredentials) : null;
    },
    async setRefresh(v) {
      if (v) await SecureStore.setItemAsync(REFRESH_KEY, JSON.stringify(v));
      else await SecureStore.deleteItemAsync(REFRESH_KEY);
    },
    getAccess: async () => access,
    setAccess: async (v) => void (access = v),
  };
  const http = createHttp({ store, tokens, lock });

  let accountKey: Uint8Array | null = null;
  let pendingRecovery: string | null = null;
  const quick = createQuickUnlock(
    {
      isBiometricAvailable: Native.isBiometricAvailable,
      biometricSeal: Native.biometricSeal,
      biometricOpen: Native.biometricOpen,
      biometricForget: Native.biometricForget,
      deviceSeal: Native.deviceSeal,
      deviceOpen: Native.deviceOpen,
    },
    secureKv,
  );
  const session: SessionPlatform = {
    getAccountKey: async () => accountKey,
    setAccountKey: async (k) => void (accountKey = k),
    clearAccountKey: async () => void (accountKey = null),
    setPendingRecovery: async (s) => void (pendingRecovery = s),
    clearPendingRecovery: async () => void (pendingRecovery = null),
    clearQuickUnlock: () => quick.clearAll(),
  };

  const requestSync = () => hooks.onRequestSync();
  const sync = createSyncEngine({ store, http, lock, getAccountKey: session.getAccountKey });
  const vault = createVaultClient({ store, getAccountKey: session.getAccountKey, requestSync });
  const accounts = createAccountService({
    store,
    http,
    session,
    device: () => ({ name: 'Android app', platform: 'android' }),
    normalizeServerUrl,
    requestSync,
  });

  return {
    store,
    http,
    accounts,
    vault,
    quick,
    getAccountKey: session.getAccountKey,
    setAccountKey: session.setAccountKey,
    clearAccountKey: session.clearAccountKey,
    getPendingRecovery: () => pendingRecovery,
    syncOnce: sync.syncOnce,
    settings: {
      async get() {
        return {
          ...DEFAULT_SETTINGS,
          ...((await store.getMeta<Partial<Settings>>('settings')) ?? {}),
        };
      },
      async update(patch) {
        const next = { ...(await this.get()), ...patch };
        await store.setMeta('settings', next);
        return next;
      },
    },
  };
}

export { SignedOutError };
