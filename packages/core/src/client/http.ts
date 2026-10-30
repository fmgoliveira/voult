import { ApiError, SignedOutError } from './errors';
import { getAccount, type ClientStore, type LockFn } from './store';

export interface RefreshCredentials {
  deviceId: string;
  refreshToken: string;
}

export interface AccessToken {
  token: string;
  /** Epoch ms after which the token must be refreshed. */
  exp: number;
}

export interface TokenStore {
  /** Persistent (survives restarts). */
  getRefresh(): Promise<RefreshCredentials | null>;
  setRefresh(value: RefreshCredentials | null): Promise<void>;
  /** Volatile cache of the short-lived access token. */
  getAccess(): Promise<AccessToken | null>;
  setAccess(value: AccessToken | null): Promise<void>;
}

export interface HttpDeps {
  store: ClientStore;
  tokens: TokenStore;
  /**
   * Refresh tokens rotate, so two contexts refreshing at once would look like token theft.
   * Provide a lock shared by every context that talks to the server.
   */
  lock: LockFn;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface Tokens {
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}

type Json = Record<string, unknown> | null;
export interface RawResponse {
  status: number;
  json: Json;
}

export function createHttp(deps: HttpDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;

  async function raw(
    serverUrl: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<RawResponse> {
    const res = await doFetch(serverUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Json = null;
    try {
      json = text ? (JSON.parse(text) as Json) : null;
    } catch {
      /* non-JSON error page */
    }
    return { status: res.status, json };
  }

  const setAccess = (token: string, expiresInSec: number) =>
    deps.tokens.setAccess({ token, exp: now() + (expiresInSec - 30) * 1000 });

  async function saveTokens(t: Tokens): Promise<void> {
    await deps.tokens.setRefresh({ deviceId: t.deviceId, refreshToken: t.refreshToken });
    await setAccess(t.accessToken, t.expiresIn);
  }

  async function clearTokens(): Promise<void> {
    await deps.tokens.setRefresh(null);
    await deps.tokens.setAccess(null);
  }

  const hasTokens = async () => (await deps.tokens.getRefresh()) !== null;

  async function freshAccessToken(serverUrl: string): Promise<string> {
    const cached = await deps.tokens.getAccess();
    if (cached && cached.exp > now()) return cached.token;
    return deps.lock('voult-refresh', async () => {
      // Another context may have refreshed while we waited for the lock.
      const again = await deps.tokens.getAccess();
      if (again && again.exp > now()) return again.token;
      const t = await deps.tokens.getRefresh();
      if (!t) throw new SignedOutError();
      const r = await raw(serverUrl, 'POST', '/auth/refresh', t);
      if (r.status === 401) {
        await clearTokens();
        throw new SignedOutError();
      }
      if (r.status !== 200 || !r.json) throw new ApiError(r.status, 'refresh_failed', r.json);
      const j = r.json as unknown as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
      await deps.tokens.setRefresh({ deviceId: t.deviceId, refreshToken: j.refreshToken });
      await setAccess(j.accessToken, j.expiresIn);
      return j.accessToken;
    });
  }

  /** Unauthenticated call (signup, prelogin, login, refresh). Throws ApiError on >= 400. */
  async function publicRequest(serverUrl: string, method: string, path: string, body?: unknown) {
    const r = await raw(serverUrl, method, path, body);
    if (r.status >= 400) throw new ApiError(r.status, String(r.json?.error ?? 'error'), r.json);
    return r.json as Record<string, unknown>;
  }

  /** Authenticated request against the account's server. Throws SignedOutError when revoked. */
  async function request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<RawResponse> {
    const account = await getAccount(deps.store);
    if (!account) throw new SignedOutError();
    const token = await freshAccessToken(account.serverUrl);
    const r = await raw(account.serverUrl, method, path, body, {
      ...headers,
      authorization: `Bearer ${token}`,
    });
    if (r.status === 401) {
      await deps.tokens.setAccess(null);
      throw new SignedOutError();
    }
    return r;
  }

  async function requestOk(method: string, path: string, body?: unknown) {
    const r = await request(method, path, body);
    if (r.status >= 400) throw new ApiError(r.status, String(r.json?.error ?? 'error'), r.json);
    return r.json;
  }

  async function getAccessToken(): Promise<{ token: string; serverUrl: string }> {
    const account = await getAccount(deps.store);
    if (!account) throw new SignedOutError();
    return { token: await freshAccessToken(account.serverUrl), serverUrl: account.serverUrl };
  }

  return { publicRequest, request, requestOk, saveTokens, clearTokens, hasTokens, getAccessToken };
}

export type Http = ReturnType<typeof createHttp>;
