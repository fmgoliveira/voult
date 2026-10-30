import { argon2id } from 'hash-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveMasterKey, setArgon2Implementation } from '../crypto/kdf';
import { itemSchema, type LoginItem } from '../vault/schemas';
import { ApiError, SignedOutError, VaultLockedError, WrongPasswordError } from './errors';
import { createTestClient, FakeServer } from './fake-server.testkit';
import { MemoryStore } from './memory-store';
import { createMutexLock } from './store';

// Cheap Argon2 for tests; also exercises the pluggable implementation hook.
beforeAll(() => {
  setArgon2Implementation(async (password, salt) =>
    argon2id({
      password,
      salt,
      memorySize: 64,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      outputType: 'binary',
    }),
  );
});
afterAll(() => setArgon2Implementation(null));

const PASSWORD = 'correct horse battery';
const creds = (serverUrl = 'https://vault.test') => ({
  email: 'Me@Example.com',
  password: PASSWORD,
  serverUrl,
});

const login = (over: Record<string, unknown> = {}) =>
  itemSchema.parse({
    type: 'login',
    title: 'GitHub',
    username: 'octo',
    password: 'pw1',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as LoginItem;

async function ready() {
  const server = new FakeServer();
  const a = createTestClient(server);
  const { recoverySecret } = await a.account.createNewAccount(creds());
  await a.account.confirmRecoveryKit();
  await a.sync.syncOnce();
  const vaultId = (await a.vault.loadVault()).vaults[0]!.id;
  return { server, a, vaultId, recoverySecret };
}

async function secondDevice(server: FakeServer) {
  const b = createTestClient(server);
  await b.account.signIn(creds());
  await b.sync.syncOnce();
  return b;
}

describe('pluggable Argon2', () => {
  it('uses the installed implementation and falls back to WASM when removed', async () => {
    let calls = 0;
    setArgon2Implementation(async () => {
      calls++;
      return new Uint8Array(32).fill(7);
    });
    expect(await deriveMasterKey('x', new Uint8Array(16))).toEqual(new Uint8Array(32).fill(7));
    expect(calls).toBe(1);
    setArgon2Implementation(null);
    const real = await deriveMasterKey('x', new Uint8Array(16), { m: 64, t: 1, p: 1 });
    expect(real).toHaveLength(32);
    expect(real).not.toEqual(new Uint8Array(32).fill(7));
    // restore the cheap test implementation for the rest of the file
    setArgon2Implementation(async (password, salt) =>
      argon2id({
        password,
        salt,
        memorySize: 64,
        iterations: 1,
        parallelism: 1,
        hashLength: 32,
        outputType: 'binary',
      }),
    );
  });
});

describe('MemoryStore + mutex', () => {
  it('serialises transactions and survives a failing one', async () => {
    const lock = createMutexLock();
    const order: string[] = [];
    const slow = lock('x', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('slow');
    });
    const failing = lock('x', async () => {
      order.push('fail');
      throw new Error('boom');
    });
    const after = lock('x', async () => void order.push('after'));
    await slow;
    await expect(failing).rejects.toThrow('boom');
    await after;
    expect(order).toEqual(['slow', 'fail', 'after']);
  });

  it('implements the store contract', async () => {
    const s = new MemoryStore();
    await s.updateItem('missing', { rev: 1 });
    await s.updateVault('missing', { rev: 1 });
    await s.updateOutbox(99, { baseRev: 1 });
    await s.addOutbox({ kind: 'item', id: 'a', baseRev: 0 });
    await s.addOutbox({ kind: 'vault', id: 'b', baseRev: 0 });
    expect((await s.listOutbox()).map((o) => o.seq)).toEqual([1, 2]);
    expect((await s.findOutbox('vault', 'b'))?.seq).toBe(2);
    await s.deleteOutbox(1);
    expect(await s.getOutbox(1)).toBeUndefined();
    await s.setMeta('k', 1);
    await s.clearAll();
    expect(await s.getMeta('k')).toBeUndefined();
    expect(await s.listOutbox()).toEqual([]);
  });
});

describe('account flows', () => {
  it('creates an account, queues the first vault, and shows the recovery secret once', async () => {
    const server = new FakeServer();
    const a = createTestClient(server);
    expect(await a.account.hasAccount()).toBe(false);
    const { recoverySecret } = await a.account.createNewAccount(creds());
    expect(a.pendingRecovery).toBe(recoverySecret);
    expect(await a.account.hasAccount()).toBe(true);
    expect(await a.session.getAccountKey()).not.toBeNull();
    expect((await a.store.listOutbox())[0]).toMatchObject({ kind: 'vault', baseRev: 0 });
    expect(a.syncRequests).toBeGreaterThan(0);
    // Items cannot be saved before the recovery kit is confirmed.
    await expect(a.vault.saveItem('x', login())).rejects.toThrow('recovery_kit_required');
    await a.account.confirmRecoveryKit();
    expect(a.pendingRecovery).toBeNull();
  });

  it('rejects non-https server URLs and closed signup', async () => {
    const server = new FakeServer();
    const a = createTestClient(server);
    await expect(a.account.createNewAccount(creds('http://vault.test'))).rejects.toThrow('https');
    await a.account.createNewAccount(creds());
    const b = createTestClient(server);
    await expect(b.account.createNewAccount(creds())).rejects.toBeInstanceOf(ApiError);
  });

  it('signs in on a second device and unlocks with the password or recovery secret', async () => {
    const { server, a, recoverySecret } = await ready();
    const b = await secondDevice(server);
    expect((await b.vault.loadVault()).vaults).toHaveLength(1);

    await b.session.clearAccountKey();
    await expect(b.account.unlockWithPassword('nope')).rejects.toBeInstanceOf(WrongPasswordError);
    await b.account.unlockWithPassword(PASSWORD);
    expect(await b.session.getAccountKey()).toEqual(await a.session.getAccountKey());

    await b.session.clearAccountKey();
    await expect(b.account.unlockWithRecoverySecret('AAAA-AAAA')).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    await b.account.unlockWithRecoverySecret(recoverySecret);
    expect(await b.session.getAccountKey()).not.toBeNull();
  });

  it('fails clearly without an account', async () => {
    const c = createTestClient(new FakeServer());
    await expect(c.account.unlockWithPassword('x')).rejects.toThrow('no_account');
    await expect(c.account.unlockWithRecoverySecret('x')).rejects.toThrow('no_account');
    await expect(c.account.reauthenticate('x')).rejects.toThrow('no_account');
    await expect(c.account.changePassword('a', 'b')).rejects.toBeInstanceOf(VaultLockedError);
    await expect(c.http.request('GET', '/sync')).rejects.toBeInstanceOf(SignedOutError);
    await expect(c.http.getAccessToken()).rejects.toBeInstanceOf(SignedOutError);
  });

  it('rejects a wrong password at sign-in', async () => {
    const { server } = await ready();
    const b = createTestClient(server);
    await expect(
      b.account.signIn({ ...creds(), password: 'wrong wrong wrong' }),
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('changes the master password and signs in with the new one', async () => {
    const { server, a } = await ready();
    await expect(a.account.changePassword('wrong', 'new password here')).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    await a.account.changePassword(PASSWORD, 'new password here');
    const b = createTestClient(server);
    await b.account.signIn({ ...creds(), password: 'new password here' });
    await a.session.clearAccountKey();
    await a.account.unlockWithPassword('new password here');
    expect(await a.session.getAccountKey()).not.toBeNull();
  });

  it('reauthenticates after revocation keeping unsynced local changes', async () => {
    const { server, a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    server.devices.clear(); // server revoked this device
    await expect(a.sync.syncOnce()).rejects.toBeInstanceOf(SignedOutError);
    expect(await a.http.hasTokens()).toBe(true); // 401 on the API call, refresh not yet attempted
    await a.account.reauthenticate(PASSWORD);
    await a.sync.syncOnce();
    expect(server.items.has(id)).toBe(true);
  });

  it('sign-out clears local data and tokens even when offline', async () => {
    const { server, a } = await ready();
    server.offline = true;
    await a.account.signOut();
    expect(await a.account.hasAccount()).toBe(false);
    expect(await a.http.hasTokens()).toBe(false);
    expect(await a.session.getAccountKey()).toBeNull();
  });
});

describe('http', () => {
  it('refreshes expired access tokens with rotating refresh tokens', async () => {
    const { server, a, vaultId } = await ready();
    const before = a.refresh!.refreshToken;
    server.expireAccessTokens();
    await a.tokens.setAccess(null);
    await a.vault.saveItem(vaultId, login());
    await a.sync.syncOnce();
    expect(a.refresh!.refreshToken).not.toBe(before);
  });

  it('signs out when the refresh token is rejected', async () => {
    const { server, a } = await ready();
    server.devices.clear();
    await a.tokens.setAccess(null);
    await expect(a.sync.syncOnce()).rejects.toBeInstanceOf(SignedOutError);
    expect(await a.http.hasTokens()).toBe(false);
  });

  it('reports refresh failures that are not auth failures', async () => {
    const { server, a } = await ready();
    await a.tokens.setAccess(null);
    server.forceStatus = 503;
    await expect(a.http.request('GET', '/sync')).rejects.toBeInstanceOf(ApiError);
    server.forceStatus = null;
  });

  it('throws SignedOutError when there is no refresh token', async () => {
    const { a } = await ready();
    await a.tokens.setAccess(null);
    await a.tokens.setRefresh(null);
    await expect(a.http.getAccessToken()).rejects.toBeInstanceOf(SignedOutError);
  });

  it('requestOk raises ApiError and tolerates non-JSON bodies', async () => {
    const { server, a } = await ready();
    await expect(a.http.requestOk('GET', '/does-not-exist')).rejects.toMatchObject({ status: 404 });
    server.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
    const a2 = createTestClient(server);
    await expect(a2.http.publicRequest('https://x.test', 'GET', '/y')).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe('sync', () => {
  it('pushes local edits and a second device receives them decrypted', async () => {
    const { server, a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    expect((await a.vault.loadVault()).items[0]!.dirty).toBe(true);
    const r = await a.sync.syncOnce();
    expect(r.pushed).toBe(1);
    expect((await a.vault.loadVault()).items[0]!.dirty).toBe(false);
    expect(server.items.get(id)).toBeDefined();

    const b = await secondDevice(server);
    const seen = (await b.vault.loadVault()).items;
    expect(seen).toHaveLength(1);
    expect((seen[0]!.item as LoginItem).password).toBe('pw1');
  });

  it('coalesces repeated edits of one item into a single queued push', async () => {
    const { a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    const view = (await a.vault.loadVault()).items[0]!;
    await a.vault.saveLoginEdit(view, { title: 'v2' });
    await a.vault.saveLoginEdit(
      { ...view, item: { ...view.item, title: 'v2' } as LoginItem },
      { title: 'v3' },
    );
    expect((await a.store.listOutbox()).filter((o) => o.id === id)).toHaveLength(1);
    expect((await a.sync.syncOnce()).pushed).toBe(1);
    expect((await a.store.getItem(id))!.version).toBe(3);
  });

  it('keeps the record dirty when it was edited again while a push was in flight', async () => {
    const { server, a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    const original = server.fetch;
    let edited = false;
    server.fetch = async (input, init) => {
      const res = await original(input, init);
      if (!edited && String(input).includes(`/items/${id}`)) {
        edited = true;
        const view = (await a.vault.loadVault()).items.find((i) => i.id === id)!;
        await a.vault.saveLoginEdit(view, { title: 'edited during push' });
      }
      return res;
    };
    await a.sync.syncOnce();
    expect((await a.store.getItem(id))!.dirty).toBe(1);
    server.fetch = original;
    await a.sync.syncOnce();
    expect((await a.store.getItem(id))!.dirty).toBe(0);
    expect((server.items.get(id) as unknown as { version: number }).version).toBe(2);
  });

  it('merges a 409 conflict, keeping the losing password in history', async () => {
    const { server, a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    await a.sync.syncOnce();
    const b = await secondDevice(server);

    const av = (await a.vault.loadVault()).items.find((i) => i.id === id)!;
    await a.vault.saveLoginEdit(av, { password: 'from-a' });
    await new Promise((r) => setTimeout(r, 5)); // b's edit is the later one
    const bv = (await b.vault.loadVault()).items.find((i) => i.id === id)!;
    await b.vault.saveLoginEdit(bv, { password: 'from-b' });
    await b.sync.syncOnce(); // b wins the race to the server
    const r = await a.sync.syncOnce(); // a conflicts, merges, retries
    expect(r.error).toBeUndefined();

    await b.sync.syncOnce();
    const merged = (await b.vault.loadVault()).items.find((i) => i.id === id)!.item as LoginItem;
    // Last writer wins (b edited later); a's password is kept in history, not lost.
    expect(merged.password).toBe('from-b');
    expect(merged.passwordHistory.map((h) => h.password)).toContain('from-a');
  });

  it('postpones conflict merging while locked, then finishes after unlock', async () => {
    const { server, a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    await a.sync.syncOnce();
    const b = await secondDevice(server);
    const bv = (await b.vault.loadVault()).items.find((i) => i.id === id)!;
    await b.vault.saveLoginEdit(bv, { password: 'b' });
    await b.sync.syncOnce();

    const av = (await a.vault.loadVault()).items.find((i) => i.id === id)!;
    await a.vault.saveLoginEdit(av, { password: 'a' });
    const key = await a.session.getAccountKey();
    await a.session.clearAccountKey();
    expect((await a.sync.syncOnce()).error).toBe('locked');
    await a.session.setAccountKey(key!);
    expect((await a.sync.syncOnce()).error).toBeUndefined();
    expect((await a.store.getItem(id))!.dirty).toBe(0);
  });

  it('works offline and reports it; queued work survives', async () => {
    const { server, a, vaultId } = await ready();
    await a.vault.saveItem(vaultId, login());
    server.offline = true;
    const r = await a.sync.syncOnce();
    expect(r).toMatchObject({ pushed: 0, error: 'offline' });
    expect(await a.store.listOutbox()).toHaveLength(1);
    server.offline = false;
    expect((await a.sync.syncOnce()).pushed).toBe(1);
  });

  it('reports a failing pull as offline and server errors as server', async () => {
    const { server, a, vaultId } = await ready();
    await a.vault.saveItem(vaultId, login());
    server.forceStatus = 503;
    expect((await a.sync.syncOnce()).error).toBe('server');
    server.forceStatus = null;
    await a.sync.syncOnce();
    const original = server.fetch;
    server.fetch = async (input, init) => {
      if (String(input).includes('/sync')) throw new TypeError('down');
      return original(input, init);
    };
    expect((await a.sync.syncOnce()).error).toBe('offline');
    server.fetch = original;
  });

  it('drops operations the server permanently rejects, and ones owned by someone else', async () => {
    const { server, a, vaultId } = await ready();
    await a.vault.saveItem(vaultId, login());
    server.forceStatus = 400;
    await a.sync.syncOnce().catch(() => undefined);
    expect(await a.store.listOutbox()).toHaveLength(0);
    server.forceStatus = null;

    const id = await a.vault.saveItem(vaultId, login());
    const original = server.fetch;
    server.fetch = async (input, init) =>
      String(input).includes(`/items/${id}`) && init?.method === 'PUT'
        ? new Response(JSON.stringify({ error: 'conflict', current: null }), { status: 409 })
        : original(input, init);
    await a.sync.syncOnce();
    expect(await a.store.listOutbox()).toHaveLength(0);
  });

  it('skips outbox entries whose record disappeared', async () => {
    const { a } = await ready();
    await a.store.addOutbox({ kind: 'item', id: 'ghost', baseRev: 0 });
    await a.sync.syncOnce();
    expect(await a.store.listOutbox()).toHaveLength(0);
  });

  it('rebases vault metadata edits after a vault conflict', async () => {
    const { server, a, vaultId } = await ready();
    const rec = (await a.store.getVault(vaultId))!;
    // Someone else bumped the vault on the server.
    server.vaults.set(vaultId, {
      ...(server.vaults.get(vaultId) as object),
      id: vaultId,
      rev: ++server.rev,
      deletedAt: null,
    } as never);
    await a.store.updateVault(vaultId, { dirty: 1, encMeta: rec.encMeta });
    await a.store.addOutbox({ kind: 'vault', id: vaultId, baseRev: rec.rev });
    const r = await a.sync.syncOnce();
    expect(r.error).toBeUndefined();
    expect((await a.store.getVault(vaultId))!.dirty).toBe(0);
  });

  it('stops retrying an endlessly conflicting item', async () => {
    const { server, a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    const original = server.fetch;
    server.fetch = async (input, init) => {
      if (String(input).includes(`/items/${id}`) && init?.method === 'PUT') {
        const cur = server.items.get(id);
        return new Response(
          JSON.stringify({
            error: 'conflict',
            current: cur ?? {
              id,
              vaultId,
              type: 'login',
              wrappedItemKey: 'x',
              ciphertext: 'y',
              version: 1,
              rev: 1,
              updatedAt: 1,
              deletedAt: null,
            },
          }),
          { status: 409 },
        );
      }
      return original(input, init);
    };
    await a.sync.syncOnce().catch(() => undefined);
    server.fetch = original;
  });

  it('purges long-trashed items locally after sync', async () => {
    const { a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    const view = (await a.vault.loadVault()).items.find((i) => i.id === id)!;
    await a.sync.syncOnce();
    await a.vault.purgeItem(view);
    await a.sync.syncOnce();
    expect(await a.store.getItem(id)).toBeUndefined();
  });
});

describe('vault client', () => {
  it('trashes and restores, and refuses when locked or the vault is unknown', async () => {
    const { a, vaultId } = await ready();
    const id = await a.vault.saveItem(vaultId, login());
    const view = (await a.vault.loadVault()).items.find((i) => i.id === id)!;
    await a.vault.trashItem(view);
    const trashed = (await a.vault.loadVault()).items.find((i) => i.id === id)!;
    expect(trashed.deletedAt).not.toBeNull();
    await a.vault.restoreItem(trashed);
    expect((await a.vault.loadVault()).items.find((i) => i.id === id)!.deletedAt).toBeNull();

    await expect(a.vault.saveItem('nope', login())).rejects.toThrow('unknown_vault');
    const note = itemSchema.parse({ type: 'note', title: 'n', createdAt: 1, updatedAt: 1 });
    await expect(a.vault.saveLoginEdit({ ...view, item: note }, {})).rejects.toThrow('not_a_login');

    await a.session.clearAccountKey();
    await expect(a.vault.loadVault()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(a.vault.saveItem(vaultId, login())).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('skips undecryptable records instead of failing the list', async () => {
    const { a, vaultId } = await ready();
    await a.vault.saveItem(vaultId, login());
    await a.store.putItem({
      id: 'bad',
      vaultId,
      type: 'login',
      wrappedItemKey: 'x',
      ciphertext: 'y',
      version: 1,
      rev: 1,
      updatedAt: 1,
      deletedAt: null,
      dirty: 0,
    });
    await a.store.putItem({
      id: 'orphan',
      vaultId: 'unknown',
      type: 'login',
      wrappedItemKey: 'x',
      ciphertext: 'y',
      version: 1,
      rev: 1,
      updatedAt: 1,
      deletedAt: null,
      dirty: 0,
    });
    await a.store.putVault({
      id: 'bad-vault',
      wrappedVaultKey: 'x',
      encMeta: 'y',
      rev: 1,
      deletedAt: null,
      dirty: 0,
    });
    expect((await a.vault.loadVault()).items).toHaveLength(1);
  });
});
