import { serve } from '@hono/node-server';
import {
  decryptItem,
  deriveLogin,
  newId,
  openVault,
  resolveConflict,
  updateLogin,
  unlockAccountKey,
  type LoginItem,
} from '@voult/core';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { purgeTrash } from '../src/jobs';
import { Client, FAST_KDF, login, testServer } from './helpers';

describe('auth', () => {
  it('signs up, closes signup after the first account, and logs in', async () => {
    const srv = testServer();
    const a = new Client(srv);
    const s = await a.signup();
    expect(s.status).toBe(201);

    const other = new Client(srv, 'other@example.com');
    expect((await other.signup()).status).toBe(403);
    expect((await a.signup()).status).toBe(403);

    const pre = await a.call('GET', '/auth/prelogin?email=ME@example.com');
    expect(pre.json.salt).toBe(s.acc.material.salt);

    const l = await a.call('POST', '/auth/login', {
      email: 'me@example.com',
      authKey: s.acc.material.authKey,
      device: { name: 'second', platform: 'android' },
    });
    expect(l.status).toBe(200);
    // The client can unlock with only what the server returned.
    const { kek } = await deriveLogin(a.password, l.json.account.salt, l.json.account.kdfParams);
    expect(unlockAccountKey(kek, l.json.account.wrappedAccountKey)).toEqual(s.acc.accountKey);
  });

  it('allows more accounts when multi-user is enabled and rejects duplicates', async () => {
    const srv = testServer({ MULTI_USER: 'true' });
    expect((await new Client(srv).signup()).status).toBe(201);
    expect((await new Client(srv).signup()).status).toBe(409);
    expect((await new Client(srv, 'b@example.com').signup()).status).toBe(201);
  });

  it('rejects bad credentials without revealing whether the account exists', async () => {
    const srv = testServer();
    const a = new Client(srv);
    await a.signup();
    const body = (email: string) => ({
      email,
      authKey: 'wrong',
      device: { name: 'x', platform: 'chrome' },
    });
    const real = await a.call('POST', '/auth/login', body('me@example.com'));
    const fake = await a.call('POST', '/auth/login', body('nobody@example.com'));
    expect(real.status).toBe(401);
    expect(fake).toMatchObject({ status: 401, json: real.json });

    const pre1 = await a.call('GET', '/auth/prelogin?email=ghost@example.com');
    const pre2 = await a.call('GET', '/auth/prelogin?email=ghost@example.com');
    expect(pre1.json).toEqual(pre2.json);
  });

  it('rate limits login to 5 per minute per IP', async () => {
    const srv = testServer();
    const a = new Client(srv);
    const body = {
      email: 'x@example.com',
      authKey: 'k',
      device: { name: 'x', platform: 'chrome' },
    };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await a.call('POST', '/auth/login', body)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
  });

  it('validates input', async () => {
    const srv = testServer();
    const a = new Client(srv);
    expect((await a.call('POST', '/auth/signup', { email: 'nope' })).status).toBe(400);
    const bad = await srv.app.request('/auth/signup', { method: 'POST', body: '{' });
    expect(bad.status).toBe(400);
  });

  it('requires a token for protected routes', async () => {
    const srv = testServer();
    const a = new Client(srv);
    expect((await a.call('GET', '/account')).status).toBe(401);
    a.session = { accessToken: 'garbage', refreshToken: '', deviceId: '', userId: '' };
    expect((await a.call('GET', '/sync')).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the device if an old one is replayed', async () => {
    const srv = testServer();
    const a = new Client(srv);
    await a.signup();
    const first = a.session;
    const r1 = await a.call('POST', '/auth/refresh', {
      deviceId: first.deviceId,
      refreshToken: first.refreshToken,
    });
    expect(r1.status).toBe(200);
    expect(r1.json.refreshToken).not.toBe(first.refreshToken);

    // Replaying the original token is treated as theft: the device is revoked entirely.
    const replay = await a.call('POST', '/auth/refresh', {
      deviceId: first.deviceId,
      refreshToken: first.refreshToken,
    });
    expect(replay.status).toBe(401);
    const after = await a.call('POST', '/auth/refresh', {
      deviceId: first.deviceId,
      refreshToken: r1.json.refreshToken,
    });
    expect(after.status).toBe(401);
    expect((await a.call('GET', '/account')).status).toBe(401);
    expect(
      (await a.call('POST', '/auth/refresh', { deviceId: 'nope', refreshToken: 'x' })).status,
    ).toBe(401);
  });

  it('lists and revokes devices; revoked access tokens stop working immediately', async () => {
    const srv = testServer();
    const a = new Client(srv);
    const s = await a.signup();
    const phone = new Client(srv);
    const l = await phone.call('POST', '/auth/login', {
      email: a.email,
      authKey: s.acc.material.authKey,
      device: { name: 'Pixel', platform: 'android' },
    });
    phone.session = l.json;

    const list = await a.call('GET', '/devices');
    expect(list.json).toHaveLength(2);
    expect(list.json.filter((d: { current: boolean }) => d.current)).toHaveLength(1);

    expect((await a.call('DELETE', `/devices/${phone.session.deviceId}`)).status).toBe(204);
    expect((await phone.call('GET', '/account')).status).toBe(401);
    expect((await a.call('DELETE', `/devices/${phone.session.deviceId}`)).status).toBe(404);
  });

  it('logout removes the device; login reuses a known deviceId', async () => {
    const srv = testServer();
    const a = new Client(srv);
    const s = await a.signup();
    const again = await a.call('POST', '/auth/login', {
      email: a.email,
      authKey: s.acc.material.authKey,
      device: { name: 'x', platform: 'chrome' },
      deviceId: a.session.deviceId,
    });
    expect(again.json.deviceId).toBe(a.session.deviceId);
    a.session = again.json;
    expect((await a.call('POST', '/auth/logout')).status).toBe(204);
    expect((await a.call('GET', '/account')).status).toBe(401);
  });

  it('changes the master password: old password and other devices stop working', async () => {
    const srv = testServer();
    const a = new Client(srv);
    const s = await a.signup();
    const other = new Client(srv);
    other.session = (
      await other.call('POST', '/auth/login', {
        email: a.email,
        authKey: s.acc.material.authKey,
        device: { name: 'o', platform: 'chrome' },
      })
    ).json;

    const { changeMasterPassword } = await import('@voult/core');
    const next = await changeMasterPassword(s.acc.accountKey, 'new password', FAST_KDF);
    const body = { ...next, currentAuthKey: s.acc.material.authKey };
    expect(
      (await a.call('POST', '/auth/change-password', { ...body, currentAuthKey: 'wrong' })).status,
    ).toBe(401);
    expect((await a.call('POST', '/auth/change-password', body)).status).toBe(204);

    expect((await other.call('GET', '/account')).status).toBe(401);
    expect((await a.call('GET', '/account')).status).toBe(200);
    const oldLogin = await a.call('POST', '/auth/login', {
      email: a.email,
      authKey: s.acc.material.authKey,
      device: { name: 'x', platform: 'chrome' },
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await a.call('POST', '/auth/login', {
      email: a.email,
      authKey: next.authKey,
      device: { name: 'x', platform: 'chrome' },
    });
    expect(newLogin.status).toBe(200);
  });
});

describe('sync', () => {
  async function setup() {
    const srv = testServer();
    const a = new Client(srv);
    const s = await a.signup();
    const v = await a.newVault(s.acc.accountKey);
    return { srv, a, s, ...v };
  }

  it('pushes items and pulls them back decryptable, incrementally', async () => {
    const { a, s, vaultId, vaultKey, rev } = await setup();
    const id = newId();
    const put = await a.putItem(vaultId, vaultKey, id, login(), 1, 0);
    expect(put.status).toBe(200);
    expect(put.json.rev).toBe(rev + 1);

    const full = await a.call('GET', '/sync?since=0');
    expect(full.json.rev).toBe(rev + 1);
    expect(full.json.vaults).toHaveLength(1);
    const rec = full.json.items[0];
    const { vaultKey: vk, meta } = openVault(s.acc.accountKey, full.json.vaults[0]);
    expect(meta.name).toBe('Personal');
    expect((decryptItem(vk, rec.id, rec.version, rec) as LoginItem).password).toBe(
      'SuperSecretPassword',
    );

    const none = await a.call('GET', `/sync?since=${rev + 1}`);
    expect(none.json).toMatchObject({ rev: rev + 1, vaults: [], items: [] });
    const upd = await a.putItem(vaultId, vaultKey, id, login({ title: 'GH2' }), 2, rev + 1);
    const inc = await a.call('GET', `/sync?since=${rev + 1}`);
    expect(inc.json.items.map((i: { rev: number }) => i.rev)).toEqual([upd.json.rev]);
    expect((await a.call('GET', '/sync?since=-1')).status).toBe(400);
  });

  it('returns 409 with the current record on a stale If-Match', async () => {
    const { a, vaultId, vaultKey } = await setup();
    const id = newId();
    const created = await a.putItem(vaultId, vaultKey, id, login(), 1, 0);
    const win = await a.putItem(vaultId, vaultKey, id, login({ title: 'A' }), 2, created.json.rev);
    expect(win.status).toBe(200);

    const lose = await a.putItem(vaultId, vaultKey, id, login({ title: 'B' }), 2, created.json.rev);
    expect(lose.status).toBe(409);
    expect(lose.json.current).toMatchObject({ id, rev: win.json.rev, version: 2 });

    // Creating an id that already exists is also a conflict.
    expect((await a.putItem(vaultId, vaultKey, id, login(), 3, 0)).status).toBe(409);
  });

  it('offline replay: queued edits replay in order and a conflict keeps the losing password', async () => {
    const { srv, a, s, vaultId, vaultKey } = await setup();
    const id = newId();
    const base = await a.putItem(vaultId, vaultKey, id, login({ updatedAt: 1 }), 1, 0);

    // Second device, offline, edits twice while the first device also edits.
    const b = new Client(srv);
    b.session = (
      await b.call('POST', '/auth/login', {
        email: a.email,
        authKey: s.acc.material.authKey,
        device: { name: 'b', platform: 'android' },
      })
    ).json;
    const queue = [
      login({ password: 'offline-1', updatedAt: 10 }),
      login({ password: 'offline-2', updatedAt: 11 }),
    ];
    await a.putItem(
      vaultId,
      vaultKey,
      id,
      login({ password: 'online', updatedAt: 5 }),
      2,
      base.json.rev,
    );

    // Replay: first op conflicts; pull current, merge, retry; second op follows on top.
    let ifMatch = base.json.rev;
    let version = 2;
    let current = login({ updatedAt: 1 });
    for (const [n, queued] of queue.entries()) {
      // Later queued edits are rebased on the latest local state (history preserved).
      const op =
        n === 0
          ? queued
          : updateLogin(
              current as LoginItem,
              { password: (queued as LoginItem).password },
              queued.updatedAt,
            );
      let r = await b.putItem(vaultId, vaultKey, id, op, version, ifMatch);
      if (r.status === 409) {
        const cur = r.json.current;
        const remote = decryptItem(vaultKey, id, cur.version, cur);
        const merged = resolveConflict(op, remote);
        version = cur.version + 1;
        ifMatch = cur.rev;
        r = await b.putItem(vaultId, vaultKey, id, merged, version, ifMatch);
        current = merged;
      } else current = op;
      expect(r.status).toBe(200);
      ifMatch = r.json.rev;
      version++;
    }
    const final = (await a.call('GET', '/sync?since=0')).json.items[0];
    const item = decryptItem(vaultKey, id, final.version, final) as LoginItem;
    expect(item.password).toBe('offline-2');
    expect(current.type).toBe('login');
    // Nothing lost: 'online' is in history after the merge of offline-1.
    expect(item.passwordHistory.map((h) => h.password)).toContain('online');
  });

  it('requires If-Match, rejects stale versions, bad ids and unknown vaults', async () => {
    const { a, vaultId, vaultKey } = await setup();
    const id = newId();
    const noHeader = await a.call('PUT', `/items/${id}`, {});
    expect(noHeader.status).toBe(428);
    expect((await a.putItem(vaultId, vaultKey, 'bad id!', login(), 1, 0)).status).toBe(400);
    expect((await a.putItem('missing', vaultKey, id, login(), 1, 0)).status).toBe(400);
    const ok = await a.putItem(vaultId, vaultKey, id, login(), 1, 0);
    const same = await a.putItem(vaultId, vaultKey, id, login(), 1, ok.json.rev);
    expect(same.status).toBe(400);
    expect(same.json.error).toBe('stale_version');
    expect((await a.call('PUT', '/vaults/bad id!', {}, { 'if-match': '0' })).status).toBe(400);
  });

  it('trash and restore via deletedAt; vault updates need the current rev', async () => {
    const { a, vaultId, vaultKey, rev } = await setup();
    const id = newId();
    const c = await a.putItem(vaultId, vaultKey, id, login(), 1, 0);
    const t = await a.putItem(vaultId, vaultKey, id, login(), 2, c.json.rev, 123);
    expect((await a.call('GET', `/sync?since=${c.json.rev}`)).json.items[0].deletedAt).toBe(123);
    const r = await a.putItem(vaultId, vaultKey, id, login(), 3, t.json.rev, null);
    expect(r.status).toBe(200);

    const sync = (await a.call('GET', '/sync?since=0')).json;
    const vault = sync.vaults[0];
    const body = {
      wrappedVaultKey: vault.wrappedVaultKey,
      encMeta: vault.encMeta,
      deletedAt: null,
    };
    expect(
      (await a.call('PUT', `/vaults/${vaultId}`, body, { 'if-match': String(rev - 1) })).status,
    ).toBe(409);
    expect(
      (await a.call('PUT', `/vaults/${vaultId}`, body, { 'if-match': String(vault.rev) })).status,
    ).toBe(200);
  });

  it('isolates users from each other', async () => {
    const srv = testServer({ MULTI_USER: 'true' });
    const a = new Client(srv);
    const sa = await a.signup();
    const { vaultId, vaultKey } = await a.newVault(sa.acc.accountKey);
    const id = newId();
    await a.putItem(vaultId, vaultKey, id, login(), 1, 0);

    const b = new Client(srv, 'b@example.com');
    const sb = await b.signup();
    expect((await b.call('GET', '/sync?since=0')).json).toMatchObject({ vaults: [], items: [] });
    // B cannot write into A's vault, nor overwrite A's item or vault ids.
    expect((await b.putItem(vaultId, vaultKey, newId(), login(), 1, 0)).status).toBe(400);
    const own = await b.newVault(sb.acc.accountKey);
    const clash = await b.putItem(own.vaultId, own.vaultKey, id, login(), 1, 0);
    expect(clash.status).toBe(409);
    expect(clash.json.current).toBeNull();
    const vClash = await b.call(
      'PUT',
      `/vaults/${vaultId}`,
      { wrappedVaultKey: 'x', encMeta: 'y' },
      { 'if-match': '0' },
    );
    expect(vClash.status).toBe(409);
    expect(vClash.json.current).toBeNull();
    expect((await b.call('DELETE', `/devices/${a.session.deviceId}`)).status).toBe(404);
  });

  it('keeps no plaintext in the database file', async () => {
    const { srv, a, vaultId, vaultKey } = await setup();
    await a.putItem(
      vaultId,
      vaultKey,
      newId(),
      login({ notes: 'my-very-private-note', urls: [{ url: 'https://secret-bank.example' }] }),
      1,
      0,
    );
    const dump = Buffer.from(srv.sqlite.serialize()).toString('latin1');
    for (const needle of [
      'SuperSecretPassword',
      'octocat',
      'GitHub',
      'my-very-private-note',
      'secret-bank.example',
      'Personal',
      'correct horse',
    ]) {
      expect(dump).not.toContain(needle);
    }
  });
});

describe('purge job', () => {
  it('removes items and vaults trashed for over 30 days', async () => {
    const srv = testServer();
    const a = new Client(srv);
    const s = await a.signup();
    const { vaultId, vaultKey } = await a.newVault(s.acc.accountKey);
    const old = newId();
    const fresh = newId();
    const live = newId();
    const day = 86_400_000;
    const now = Date.now();
    const o = await a.putItem(vaultId, vaultKey, old, login(), 1, 0, now - 31 * day);
    await a.putItem(vaultId, vaultKey, fresh, login(), 1, 0, now - 1 * day);
    await a.putItem(vaultId, vaultKey, live, login(), 1, 0);
    expect(o.status).toBe(200);
    expect(purgeTrash(srv.db, now)).toEqual({ items: 1, vaults: 0 });
    const ids = (await a.call('GET', '/sync?since=0')).json.items.map((i: { id: string }) => i.id);
    expect(ids.sort()).toEqual([fresh, live].sort());
  });
});

describe('websocket', () => {
  it('pushes "rev changed" to authenticated sockets only', async () => {
    const srv = testServer();
    const server = serve({ fetch: srv.app.fetch, port: 0 });
    srv.injectWebSocket(server);
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;

    try {
      const a = new Client(srv);
      const s = await a.signup();
      const { vaultId, vaultKey } = await a.newVault(s.acc.accountKey);

      const open = (token: string) =>
        new Promise<{ ws: WebSocket; msgs: string[] }>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
          const msgs: string[] = [];
          ws.on('message', (m) => msgs.push(String(m)));
          ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
          resolve({ ws, msgs });
        });
      const waitFor = async (cond: () => boolean) => {
        for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
        expect(cond()).toBe(true);
      };

      const good = await open(a.session.accessToken);
      await waitFor(() => good.msgs.includes('{"type":"ready"}'));
      const closed = new Promise<number>((r) => {
        const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        bad.on('open', () => bad.send(JSON.stringify({ type: 'auth', token: 'nope' })));
        bad.on('close', (code) => r(code));
      });
      expect(await closed).toBe(4401);

      const put = await a.putItem(vaultId, vaultKey, newId(), login(), 1, 0);
      await waitFor(() => good.msgs.includes(JSON.stringify({ type: 'rev', rev: put.json.rev })));
      expect(srv.hub.count(s.acc.material.salt)).toBe(0);
      good.ws.close();
      await waitFor(() => srv.hub.count(a.session.userId) === 0);
    } finally {
      server.close();
    }
  });
});

describe('misc', () => {
  it('health, security headers, size limit and unknown routes', async () => {
    const srv = testServer();
    const h = await srv.app.request('/health');
    expect(h.headers.get('x-content-type-options')).toBe('nosniff');
    const big = await srv.app.request('/auth/signup', {
      method: 'POST',
      body: 'x'.repeat(3 * 1024 * 1024),
    });
    expect(big.status).toBe(413);
    expect((await srv.app.request('/nope')).status).toBe(401); // unknown paths reveal nothing
  });
});
