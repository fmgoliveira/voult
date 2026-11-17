import {
  createAccountService,
  createHttp,
  createMutexLock,
  createSyncEngine,
  createVaultClient,
  getAccount,
  normalizeServerUrl,
  publicKeyBlob,
  utf8,
  type AccessToken,
  type ClientStore,
  type ItemView,
  type RefreshCredentials,
  type SessionPlatform,
  type TokenStore,
} from '@voult/core';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { loadConfig, type Config } from './config';
import type { Dpapi } from './dpapi';
import { FileStore } from './file-store';
import { Keyring, type AgentKey } from './keyring';
import type { Paths } from './paths';

export interface RuntimeDeps {
  paths: Paths;
  dpapi: Dpapi;
  fetch?: typeof fetch;
  now?: () => number;
  /** Use this store instead of the on-disk one (tests). */
  store?: ClientStore;
  /** Called after every successful unlock/sync with the decrypted vault. */
  afterSync?: (items: ItemView[]) => Promise<void> | void;
}

export interface Status {
  signedIn: boolean;
  email: string | null;
  serverUrl: string | null;
  unlocked: boolean;
  /** Keys the agent can serve right now (0 while locked). */
  agentKeys: number;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  idleLockMinutes: number;
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** Everything the companion does with the account, free of any pipe or CLI plumbing. */
export function createRuntime(deps: RuntimeDeps) {
  const { paths, dpapi } = deps;
  const now = deps.now ?? Date.now;
  const store: ClientStore = deps.store ?? new FileStore(paths.store);
  const lock = createMutexLock();
  const keyring = new Keyring();
  let config: Config = loadConfig(paths.config);

  // ---- tokens: the refresh token is DPAPI-protected on disk, the access token stays in memory.
  let refreshCache: RefreshCredentials | null | undefined;
  let access: AccessToken | null = null;
  const tokens: TokenStore = {
    async getRefresh() {
      if (refreshCache !== undefined) return refreshCache;
      if (!existsSync(paths.session)) return (refreshCache = null);
      try {
        const file = JSON.parse(readFileSync(paths.session, 'utf8')) as { refresh?: string };
        if (!file.refresh) return (refreshCache = null);
        refreshCache = JSON.parse(
          Buffer.from(await dpapi.unprotect(unb64(file.refresh))).toString('utf8'),
        ) as RefreshCredentials;
      } catch {
        refreshCache = null; // unreadable (e.g. another Windows user): sign in again
      }
      return refreshCache;
    },
    async setRefresh(v) {
      refreshCache = v;
      if (!v) {
        rmSync(paths.session, { force: true });
        return;
      }
      const sealed = await dpapi.protect(utf8(JSON.stringify(v)));
      mkdirSync(path.dirname(paths.session), { recursive: true });
      writeFileSync(paths.session, JSON.stringify({ version: 1, refresh: b64(sealed) }));
    },
    getAccess: async () => access,
    setAccess: async (v) => void (access = v),
  };

  // ---- account key: memory only, zeroed on lock.
  let accountKey: Uint8Array | null = null;
  const wipeAccountKey = () => {
    accountKey?.fill(0);
    accountKey = null;
  };
  const session: SessionPlatform = {
    getAccountKey: async () => accountKey,
    setAccountKey: async (k) => {
      wipeAccountKey();
      accountKey = k;
    },
    clearAccountKey: async () => wipeAccountKey(),
    setPendingRecovery: async () => undefined,
    clearPendingRecovery: async () => undefined,
    clearQuickUnlock: async () => undefined,
  };

  const http = createHttp({ store, tokens, lock, fetch: deps.fetch });
  const requestSync = () => undefined; // the daemon syncs explicitly
  const sync = createSyncEngine({ store, http, lock, getAccountKey: session.getAccountKey });
  const vault = createVaultClient({ store, getAccountKey: session.getAccountKey, requestSync });
  const account = createAccountService({
    store,
    http,
    session,
    device: () => ({ name: `Voult desktop (${hostname()})`, platform: 'other' }),
    normalizeServerUrl,
    requestSync,
  });

  let lastActivity = now();
  let lastSyncAt: number | null = null;
  let lastSyncError: string | null = null;

  const touch = () => void (lastActivity = now());

  /** Decrypt the vault and load the agent's keys. Only runs while unlocked. */
  async function refreshKeys(): Promise<ItemView[]> {
    const { items } = await vault.loadVault();
    const keys: AgentKey[] = [];
    for (const v of items) {
      const it = v.item;
      if (v.deletedAt !== null || it.type !== 'sshKey' || !it.agent.enabled || !it.privateKey) {
        continue;
      }
      try {
        keys.push({
          itemId: v.id,
          title: it.title,
          keyType: it.keyType,
          fingerprint: it.fingerprint,
          blob: publicKeyBlob(it.publicKey),
          confirm: it.agent.confirm,
          privateKey: utf8(it.privateKey),
        });
      } catch {
        /* a key with a broken public line cannot be offered */
      }
    }
    keyring.replace(keys);
    await deps.afterSync?.(items);
    return items;
  }

  async function runSync(): Promise<{ pushed: number; pulled: number; error?: string }> {
    const res = await sync.syncOnce();
    lastSyncAt = now();
    lastSyncError = res.error ?? null;
    if (accountKey) await refreshKeys();
    return res;
  }

  async function login(c: { serverUrl: string; email: string; password: string }) {
    await account.signIn(c);
    touch();
    return runSync();
  }

  async function unlock(password: string) {
    await account.unlockWithPassword(password);
    touch();
    // Work from the local copy first so the agent is usable offline, then catch up.
    await refreshKeys();
    return runSync();
  }

  function lockVault(): void {
    keyring.wipe();
    wipeAccountKey();
  }

  async function logout(): Promise<void> {
    lockVault();
    await account.signOut();
  }

  /** Lock when the vault has been idle for the configured time. Returns true if it locked. */
  function checkIdle(): boolean {
    if (!accountKey || config.idleLockMinutes <= 0) return false;
    if (now() - lastActivity < config.idleLockMinutes * 60_000) return false;
    lockVault();
    return true;
  }

  async function status(): Promise<Status> {
    const a = await getAccount(store);
    return {
      signedIn: !!a,
      email: a?.email ?? null,
      serverUrl: a?.serverUrl ?? null,
      unlocked: accountKey !== null,
      agentKeys: keyring.size,
      lastSyncAt,
      lastSyncError,
      idleLockMinutes: config.idleLockMinutes,
    };
  }

  return {
    store,
    keyring,
    get config() {
      return config;
    },
    setConfig(c: Config) {
      config = c;
    },
    login,
    unlock,
    lock: lockVault,
    logout,
    sync: runSync,
    status,
    touch,
    checkIdle,
    isUnlocked: () => accountKey !== null,
    loadItems: async () => (accountKey ? (await vault.loadVault()).items : []),
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
