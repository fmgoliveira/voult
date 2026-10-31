import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Config } from '../config';

/** The slice of Google OAuth + Drive v3 we use. Injected so tests never touch the network. */
export interface GoogleApi {
  authUrl(state: string): string;
  /** Exchanges the OAuth code for a refresh token (and the account's email, if readable). */
  exchangeCode(code: string): Promise<{ refreshToken: string; email: string | null }>;
  accessToken(refreshToken: string): Promise<string>;
  /** Returns a usable "Voult Backups" folder id, creating it when `known` is missing or trashed. */
  ensureFolder(token: string, known: string | null): Promise<string>;
  upload(
    token: string,
    folderId: string,
    name: string,
    content: string,
  ): Promise<{ id: string; size: number }>;
  /** Files in the folder, newest first. */
  list(token: string, folderId: string): Promise<{ id: string; name: string }[]>;
  remove(token: string, fileId: string): Promise<void>;
  revoke(refreshToken: string): Promise<void>;
}

export class GoogleError extends Error {
  constructor(
    /** Short stable code, safe to show to the user. */
    readonly code: string,
  ) {
    super(code);
  }
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'Voult Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

type Fetch = typeof fetch;

export function createGoogleApi(cfg: Config, fetchFn: Fetch = fetch): GoogleApi {
  const g = cfg.google;
  if (!g) throw new Error('google_not_configured');
  const redirectUri = `${g.publicUrl}/backup/google/callback`;

  async function json(res: Response, what: string): Promise<Record<string, unknown>> {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // invalid_grant = the user revoked access in their Google account.
      if (body.error === 'invalid_grant') throw new GoogleError('google_access_revoked');
      if (res.status === 401 || res.status === 403) throw new GoogleError('google_denied');
      throw new GoogleError(`google_${what}_failed`);
    }
    return body;
  }

  const authed = (token: string, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
  });

  return {
    authUrl(state) {
      const q = new URLSearchParams({
        client_id: g.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent', // always return a refresh token
        include_granted_scopes: 'true',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },

    async exchangeCode(code) {
      const body = await json(
        await fetchFn('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: g.clientId,
            client_secret: g.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        }),
        'token',
      );
      const refreshToken = body.refresh_token;
      if (typeof refreshToken !== 'string') throw new GoogleError('google_no_refresh_token');
      let email: string | null = null;
      try {
        const about = await json(
          await fetchFn(
            'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
            authed(String(body.access_token)),
          ),
          'about',
        );
        email =
          ((about.user as { emailAddress?: string } | undefined)?.emailAddress ?? null) || null;
      } catch {
        /* cosmetic only */
      }
      return { refreshToken, email };
    },

    async accessToken(refreshToken) {
      const body = await json(
        await fetchFn('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: g.clientId,
            client_secret: g.clientSecret,
            grant_type: 'refresh_token',
          }),
        }),
        'token',
      );
      return String(body.access_token);
    },

    async ensureFolder(token, known) {
      if (known) {
        const res = await fetchFn(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(known)}?fields=id,trashed`,
          authed(token),
        );
        if (res.ok) {
          const f = (await res.json()) as { id: string; trashed?: boolean };
          if (!f.trashed) return f.id;
        }
      }
      // drive.file only sees files this app created, so a name search cannot pick up foreign folders.
      const q = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`;
      const found = await json(
        await fetchFn(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
          authed(token),
        ),
        'list',
      );
      const first = (found.files as { id: string }[] | undefined)?.[0];
      if (first) return first.id;
      const created = await json(
        await fetchFn(
          'https://www.googleapis.com/drive/v3/files?fields=id',
          authed(token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
          }),
        ),
        'folder',
      );
      return String(created.id);
    },

    async upload(token, folderId, name, content) {
      const boundary = `voult-${randomBytes(12).toString('hex')}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' })}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
      const f = await json(
        await fetchFn(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size',
          authed(token, {
            method: 'POST',
            headers: { 'content-type': `multipart/related; boundary=${boundary}` },
            body,
          }),
        ),
        'upload',
      );
      return { id: String(f.id), size: Number(f.size ?? Buffer.byteLength(content)) };
    },

    async list(token, folderId) {
      const q = `'${folderId}' in parents and trashed=false`;
      const out: { id: string; name: string }[] = [];
      let page: string | undefined;
      do {
        const params = new URLSearchParams({
          q,
          orderBy: 'createdTime desc',
          fields: 'nextPageToken,files(id,name)',
          pageSize: '100',
        });
        if (page) params.set('pageToken', page);
        const r = await json(
          await fetchFn(`https://www.googleapis.com/drive/v3/files?${params}`, authed(token)),
          'list',
        );
        out.push(...((r.files as { id: string; name: string }[] | undefined) ?? []));
        page = r.nextPageToken as string | undefined;
      } while (page);
      return out;
    },

    async remove(token, fileId) {
      const res = await fetchFn(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
        authed(token, { method: 'DELETE' }),
      );
      if (!res.ok && res.status !== 404) throw new GoogleError('google_delete_failed');
    },

    async revoke(refreshToken) {
      await fetchFn(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        { method: 'POST' },
      ).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------- token at rest

const tokenKey = (cfg: Config) =>
  Buffer.from(hkdfSync('sha256', cfg.jwtSecret, '', 'voult:backup-refresh-token', 32));

/** AES-256-GCM under a key derived from the server secret: a DB leak alone reveals no token. */
export function sealToken(cfg: Config, token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', tokenKey(cfg), iv);
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function openToken(cfg: Config, sealed: string): string {
  const raw = Buffer.from(sealed, 'base64url');
  const d = createDecipheriv('aes-256-gcm', tokenKey(cfg), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
