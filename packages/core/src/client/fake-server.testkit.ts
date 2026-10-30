import { createHttp, type Http, type TokenStore } from './http';
import { MemoryStore } from './memory-store';
import { createMutexLock } from './store';
import { createSyncEngine } from './sync';
import { createVaultClient } from './vault-client';
import { createAccountService, type SessionPlatform } from './account';

interface Rec {
  [k: string]: unknown;
  id: string;
  rev: number;
  deletedAt: number | null;
}

/**
 * A minimal in-memory implementation of the Voult server protocol, enough to drive the client
 * code end to end (auth, rotating refresh tokens, rev + If-Match, 409 with current record).
 */
export class FakeServer {
  url = 'https://vault.test';
  user: Record<string, unknown> | null = null;
  rev = 0;
  items = new Map<string, Rec>();
  vaults = new Map<string, Rec>();
  devices = new Map<string, string>(); // deviceId -> refresh token
  accessTokens = new Map<string, string>(); // token -> deviceId
  private n = 0;
  /** Test knobs. */
  offline = false;
  forceStatus: number | null = null;
  requests: string[] = [];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (this.offline) throw new TypeError('network down');
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    this.requests.push(`${method} ${url.pathname}`);
    if (this.forceStatus && url.pathname !== '/auth/refresh') {
      return this.json(this.forceStatus, { error: 'forced' });
    }
    const res = this.route(method, url, body, headers);
    return res;
  };

  private json(status: number, body: unknown) {
    return new Response(body === null ? null : JSON.stringify(body), { status });
  }

  private issue(deviceId: string) {
    const refreshToken = `r${++this.n}`;
    const accessToken = `a${++this.n}`;
    this.devices.set(deviceId, refreshToken);
    this.accessTokens.set(accessToken, deviceId);
    return { userId: 'u1', deviceId, refreshToken, accessToken, expiresIn: 900 };
  }

  /** Expire every access token (forces a refresh on the next call). */
  expireAccessTokens() {
    this.accessTokens.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private route(method: string, url: URL, body: any, headers: Headers): Response {
    const p = url.pathname;
    if (p === '/auth/signup') {
      if (this.user) return this.json(403, { error: 'signup_closed' });
      this.user = { ...body };
      return this.json(201, this.issue(`d${++this.n}`));
    }
    if (p === '/auth/prelogin') {
      const u = this.user;
      return this.json(200, {
        salt: (u?.salt as string) ?? 'AAAAAAAAAAAAAAAAAAAAAA',
        kdfParams: (u?.kdfParams as object) ?? { m: 64, t: 1, p: 1 },
      });
    }
    if (p === '/auth/login') {
      if (!this.user || this.user.authKey !== body.authKey)
        return this.json(401, { error: 'invalid_credentials' });
      const id = body.deviceId && this.devices.has(body.deviceId) ? body.deviceId : `d${++this.n}`;
      return this.json(200, {
        ...this.issue(id),
        account: {
          kdfParams: this.user.kdfParams,
          salt: this.user.salt,
          wrappedAccountKey: this.user.wrappedAccountKey,
          wrappedRecoveryKey: this.user.wrappedRecoveryKey,
        },
      });
    }
    if (p === '/auth/refresh') {
      const cur = this.devices.get(body.deviceId);
      if (!cur) return this.json(401, { error: 'invalid_refresh' });
      if (cur !== body.refreshToken) {
        this.devices.delete(body.deviceId); // theft detection
        return this.json(401, { error: 'invalid_refresh' });
      }
      if (this.forceStatus) return this.json(this.forceStatus, { error: 'forced' });
      return this.json(200, this.issue(body.deviceId));
    }

    const auth = headers.get('authorization')?.replace('Bearer ', '') ?? '';
    const deviceId = this.accessTokens.get(auth);
    if (!deviceId || !this.devices.has(deviceId)) return this.json(401, { error: 'unauthorized' });

    if (p === '/auth/logout') {
      this.devices.delete(deviceId);
      return this.json(204, null);
    }
    if (p === '/auth/change-password') {
      if (this.user!.authKey !== body.currentAuthKey)
        return this.json(401, { error: 'invalid_credentials' });
      Object.assign(this.user!, {
        authKey: body.authKey,
        salt: body.salt,
        kdfParams: body.kdfParams,
        wrappedAccountKey: body.wrappedAccountKey,
      });
      return this.json(204, null);
    }
    if (p === '/sync') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return this.json(200, {
        rev: this.rev,
        vaults: [...this.vaults.values()].filter((v) => v.rev > since),
        items: [...this.items.values()].filter((i) => i.rev > since),
      });
    }
    const m = /^\/(items|vaults)\/(.+)$/.exec(p);
    if (m && method === 'PUT') {
      const table = m[1] === 'items' ? this.items : this.vaults;
      const id = m[2]!;
      const expected = Number(headers.get('if-match'));
      const cur = table.get(id);
      if ((cur?.rev ?? 0) !== expected)
        return this.json(409, { error: 'conflict', current: cur ?? null });
      const rev = ++this.rev;
      table.set(id, { ...body, id, rev, deletedAt: body.deletedAt ?? null, updatedAt: Date.now() });
      return this.json(200, { rev });
    }
    if (p === '/devices') return this.json(200, []);
    return this.json(404, { error: 'not_found' });
  }
}

/** One simulated device: store + http + sync + vault client + account service. */
export function createTestClient(server: FakeServer, opts: { sync?: boolean } = {}) {
  const store = new MemoryStore();
  const lock = createMutexLock();
  let refresh: { deviceId: string; refreshToken: string } | null = null;
  let access: { token: string; exp: number } | null = null;
  const tokens: TokenStore = {
    getRefresh: async () => refresh,
    setRefresh: async (v) => void (refresh = v),
    getAccess: async () => access,
    setAccess: async (v) => void (access = v),
  };
  const http: Http = createHttp({
    store,
    tokens,
    lock,
    fetch: ((i: string | URL | Request, n?: RequestInit) => server.fetch(i, n)) as typeof fetch,
  });

  let accountKey: Uint8Array | null = null;
  let pending: string | null = null;
  let syncRequests = 0;
  const session: SessionPlatform = {
    getAccountKey: async () => accountKey,
    setAccountKey: async (k) => void (accountKey = k),
    clearAccountKey: async () => void (accountKey = null),
    setPendingRecovery: async (s) => void (pending = s),
    clearPendingRecovery: async () => void (pending = null),
    clearQuickUnlock: async () => undefined,
  };
  const requestSync = () => void syncRequests++;
  const sync = createSyncEngine({ store, http, lock, getAccountKey: session.getAccountKey });
  const vault = createVaultClient({ store, getAccountKey: session.getAccountKey, requestSync });
  const account = createAccountService({
    store,
    http,
    session,
    device: () => ({ name: 'test', platform: 'other' }),
    normalizeServerUrl: (u) => {
      if (!u.startsWith('https://')) throw new Error('https required');
      return new URL(u).origin;
    },
    requestSync,
  });
  void opts;
  return {
    store,
    http,
    sync,
    vault,
    account,
    session,
    tokens,
    get refresh() {
      return refresh;
    },
    get pendingRecovery() {
      return pending;
    },
    get syncRequests() {
      return syncRequests;
    },
  };
}
export type TestClient = ReturnType<typeof createTestClient>;
