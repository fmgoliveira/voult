import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { db } from './db';

/** Thrown when the server rejected our credentials for good (device revoked, token stolen). */
export class SignedOutError extends Error {
  constructor() {
    super('signed_out');
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(code);
  }
}

interface Tokens {
  deviceId: string;
  refreshToken: string;
}
const tokensItem = storage.defineItem<Tokens | null>('local:tokens', { fallback: null });

const access = {
  async get(): Promise<{ token: string; exp: number } | null> {
    const r = await browser.storage.session.get('access');
    return (r.access as { token: string; exp: number } | undefined) ?? null;
  },
  async set(token: string, expiresInSec: number) {
    await browser.storage.session.set({
      access: { token, exp: Date.now() + (expiresInSec - 30) * 1000 },
    });
  },
};

export const saveTokens = async (t: {
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}) => {
  await tokensItem.setValue({ deviceId: t.deviceId, refreshToken: t.refreshToken });
  await access.set(t.accessToken, t.expiresIn);
};

export const clearTokens = async () => {
  await tokensItem.setValue(null);
  await browser.storage.session.remove(['access']);
};

export const hasTokens = async () => (await tokensItem.getValue()) !== null;

async function rawFetch(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  headers = {},
) {
  const res = await fetch(serverUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status, json: json as Record<string, unknown> | null };
}

/**
 * Refresh tokens rotate, so two contexts refreshing at once would look like token theft.
 * A Web Lock shared by every extension context serialises them; the loser re-reads storage.
 */
async function freshAccessToken(serverUrl: string): Promise<string> {
  const cached = await access.get();
  if (cached && cached.exp > Date.now()) return cached.token;
  const run = async (): Promise<string> => {
    const again = await access.get();
    if (again && again.exp > Date.now()) return again.token;
    const t = await tokensItem.getValue();
    if (!t) throw new SignedOutError();
    const r = await rawFetch(serverUrl, 'POST', '/auth/refresh', t);
    if (r.status === 401) {
      await clearTokens();
      throw new SignedOutError();
    }
    if (r.status !== 200 || !r.json) throw new ApiError(r.status, 'refresh_failed', r.json);
    const j = r.json as unknown as { accessToken: string; refreshToken: string; expiresIn: number };
    await tokensItem.setValue({ deviceId: t.deviceId, refreshToken: j.refreshToken });
    await access.set(j.accessToken, j.expiresIn);
    return j.accessToken;
  };
  return navigator.locks ? navigator.locks.request('voult-refresh', run) : run();
}

export async function publicRequest(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await rawFetch(serverUrl, method, path, body);
  if (r.status >= 400) throw new ApiError(r.status, String(r.json?.error ?? 'error'), r.json);
  return r.json as Record<string, unknown>;
}

/** Authenticated request against the user's configured server. */
export async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const account = await db.getAccount();
  if (!account) throw new SignedOutError();
  const token = await freshAccessToken(account.serverUrl);
  const r = await rawFetch(account.serverUrl, method, path, body, {
    ...headers,
    authorization: `Bearer ${token}`,
  });
  if (r.status === 401) {
    // Device was revoked server-side.
    await browser.storage.session.remove(['access']);
    throw new SignedOutError();
  }
  return r;
}

export async function requestOk(method: string, path: string, body?: unknown) {
  const r = await request(method, path, body);
  if (r.status >= 400) throw new ApiError(r.status, String(r.json?.error ?? 'error'), r.json);
  return r.json;
}

/** Current valid access token (refreshing if needed); used by the realtime socket. */
export async function getAccessToken(): Promise<{ token: string; serverUrl: string }> {
  const account = await db.getAccount();
  if (!account) throw new SignedOutError();
  return { token: await freshAccessToken(account.serverUrl), serverUrl: account.serverUrl };
}
