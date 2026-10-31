import { newId, openSnapshot, parseSnapshot, snapshotChecksum } from '@voult/core';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { GoogleError, openToken, sealToken, type GoogleApi } from '../src/backup/google';
import { runDueBackups } from '../src/backup/service';
import { backupSettings } from '../src/db/schema';
import { Client, login, testServer } from './helpers';

/** In-memory Drive: stores uploaded files by id, newest first. */
function fakeGoogle() {
  const files: { id: string; name: string; content: string; at: number }[] = [];
  let n = 0;
  const state = { failNext: null as string | null, revoked: [] as string[], clock: 1 };
  const api: GoogleApi = {
    authUrl: (s) => `https://accounts.example/auth?state=${s}`,
    async exchangeCode(code) {
      if (code !== 'good-code') throw new GoogleError('google_token_failed');
      return { refreshToken: 'REFRESH-TOKEN-SECRET', email: 'me@gmail.com' };
    },
    async accessToken(refresh) {
      if (state.failNext) {
        const e = state.failNext;
        state.failNext = null;
        throw new GoogleError(e);
      }
      expect(refresh).toBe('REFRESH-TOKEN-SECRET');
      return 'access';
    },
    ensureFolder: async (_t, known) => known ?? 'folder-1',
    async upload(_t, folder, name, content) {
      expect(folder).toBe('folder-1');
      files.push({ id: `f${++n}`, name, content, at: state.clock++ });
      return { id: `f${n}`, size: content.length };
    },
    list: async () =>
      [...files].sort((a, b) => b.at - a.at).map((f) => ({ id: f.id, name: f.name })),
    async remove(_t, id) {
      files.splice(
        files.findIndex((f) => f.id === id),
        1,
      );
    },
    async revoke(t) {
      state.revoked.push(t);
    },
  };
  return { api, files, state };
}

async function setup(env: Record<string, string | undefined> = {}) {
  const drive = fakeGoogle();
  const srv = testServer({
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    PUBLIC_URL: 'https://vault.example',
    ...env,
  });
  // Re-create the app with the fake Google API, keeping the same config and database.
  const { createApp } = await import('../src/app');
  const server = createApp(srv.cfg, srv.db, drive.api);
  const a = new Client({ ...srv, ...server });
  const s = await a.signup();
  const v = await a.newVault(s.acc.accountKey);
  await a.putItem(v.vaultId, v.vaultKey, newId(), login(), 1, 0);
  await a.putItem(
    v.vaultId,
    v.vaultKey,
    newId(),
    login({
      title: 'Passkey site',
      totp: { secret: 'JBSWY3DPEHPK3PXP' },
      passkeys: [
        {
          credentialId: 'c1',
          rpId: 'example.com',
          userHandle: 'h',
          privateKey: 'k',
          signCount: 0,
          createdAt: 1,
        },
      ],
    }),
    1,
    0,
  );
  return { srv: { ...srv, ...server }, a, s, drive };
}

async function connect(a: Client, srv: { app: { request: (u: string) => Promise<Response> } }) {
  const start = await a.call('POST', '/backup/google/start');
  expect(start.status).toBe(200);
  const state = new URL(start.json.url).searchParams.get('state')!;
  const cb = await srv.app.request(`/backup/google/callback?code=good-code&state=${state}`);
  return { cb, state };
}

describe('google drive backup', () => {
  it('connects, uploads a snapshot that restores with the master password, and reports status', async () => {
    const { srv, a, s, drive } = await setup();
    expect((await a.call('GET', '/backup')).json).toMatchObject({
      available: true,
      connected: false,
    });

    const { cb } = await connect(a, srv);
    expect(cb.status).toBe(200);
    expect((await a.call('GET', '/backup')).json).toMatchObject({
      connected: true,
      email: 'me@gmail.com',
      enabled: true,
    });

    const run = await a.call('POST', '/backup/run');
    expect(run.status).toBe(200);
    expect(drive.files).toHaveLength(1);
    expect(drive.files[0]!.name).toMatch(/^voult-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.voult$/);

    // The Drive file alone (no server) opens with the master password.
    const snap = parseSnapshot(drive.files[0]!.content);
    expect(snap.email).toBe('me@example.com');
    const opened = await openSnapshot(snap, { masterPassword: a.password });
    expect(opened.counts).toEqual({ items: 2, totp: 1, passkeys: 1 });
    expect(snapshotChecksum(snap)).toHaveLength(43);
    void s;

    const st = (await a.call('GET', '/backup')).json;
    expect(st.lastError).toBeNull();
    expect(st.lastSuccessAt).toBeGreaterThan(0);
    expect(st.files).toHaveLength(1);
  });

  it('keeps nothing readable in Drive and stores the refresh token encrypted', async () => {
    const { srv, a, drive } = await setup();
    await connect(a, srv);
    await a.call('POST', '/backup/run');
    expect(drive.files[0]!.content).not.toContain('SuperSecretPassword');
    expect(drive.files[0]!.content).not.toContain('octocat');

    const row = srv.db.select().from(backupSettings).get()!;
    expect(row.refreshTokenEnc).not.toContain('REFRESH-TOKEN-SECRET');
    expect(openToken(srv.cfg, row.refreshTokenEnc)).toBe('REFRESH-TOKEN-SECRET');
    expect(() => openToken(srv.cfg, sealToken(srv.cfg, 'x').slice(0, -3) + 'AAA')).toThrow();
  });

  it('keeps only the newest N snapshots', async () => {
    const { srv, a, drive } = await setup({ BACKUP_RETENTION: '3' });
    await connect(a, srv);
    for (let i = 0; i < 5; i++) expect((await a.call('POST', '/backup/run')).status).toBe(200);
    expect(drive.files).toHaveLength(3);
    expect((await a.call('GET', '/backup')).json.files).toHaveLength(3);
  });

  it('records failures, then runs when due and retries after an hour', async () => {
    const { srv, a, drive } = await setup();
    await connect(a, srv);
    drive.state.failNext = 'google_access_revoked';
    const bad = await a.call('POST', '/backup/run');
    expect(bad.status).toBe(502);
    expect(bad.json.error).toBe('google_access_revoked');
    expect((await a.call('GET', '/backup')).json.lastError).toBe('google_access_revoked');

    const deps = srv.backupDeps;
    const row = () => srv.db.select().from(backupSettings).get()!;
    const t0 = row().lastAttemptAt!;
    expect(await runDueBackups(deps, t0 + 60_000)).toBe(0); // failed a minute ago: wait
    expect(await runDueBackups(deps, t0 + 3_700_000)).toBe(1); // an hour later: retry
    expect(row().lastError).toBeNull();
    const ok = row().lastSuccessAt!;
    expect(await runDueBackups(deps, ok + 3_600_000)).toBe(0); // daily, not hourly
    expect(await runDueBackups(deps, ok + 25 * 3_600_000)).toBe(1);

    await a.call('PUT', '/backup/settings', { enabled: false });
    expect(await runDueBackups(deps, ok + 100 * 3_600_000)).toBe(0);
  });

  it('rejects forged or expired OAuth state and disconnects cleanly', async () => {
    const { srv, a, drive } = await setup();
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('someone')
      .setAudience('voult-backup-oauth')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('y'.repeat(40)));
    const bad = await srv.app.request(`/backup/google/callback?code=good-code&state=${forged}`);
    expect(bad.status).toBe(400);
    expect((await srv.app.request('/backup/google/callback?code=x')).status).toBe(400);

    await connect(a, srv);
    expect((await a.call('DELETE', '/backup/google')).status).toBe(200);
    expect(drive.state.revoked).toEqual(['REFRESH-TOKEN-SECRET']);
    expect((await a.call('GET', '/backup')).json.connected).toBe(false);
    expect((await a.call('POST', '/backup/run')).status).toBe(409);
  });

  it('requires a login and reports when Google is not configured', async () => {
    const srv = testServer();
    expect((await srv.app.request('/backup')).status).toBe(401);
    const a = new Client(srv);
    await a.signup();
    expect((await a.call('GET', '/backup')).json).toMatchObject({ available: false });
    expect((await a.call('POST', '/backup/google/start')).status).toBe(503);
  });
});
