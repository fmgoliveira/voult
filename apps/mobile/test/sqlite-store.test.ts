import { itemSchema, setArgon2Implementation, type LoginItem } from '@voult/core';
import { createTestClient, FakeServer } from '@voult/core/testkit';
import BetterSqlite3 from 'better-sqlite3';
import { argon2id } from 'hash-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteStore, type SqlDb } from '../src/store/sqlite-store';

/** expo-sqlite-shaped wrapper around better-sqlite3 so the real SQL runs in Node tests. */
function memoryDb(): SqlDb {
  const db = new BetterSqlite3(':memory:');
  return {
    execAsync: async (sql) => void db.exec(sql),
    runAsync: async (sql, params = []) => db.prepare(sql).run(...(params as never[])),
    getAllAsync: async <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
    getFirstAsync: async <T>(sql: string, params: unknown[] = []) =>
      (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null,
  };
}

const item = (id: string, over = {}) => ({
  id,
  vaultId: 'v1',
  type: 'login',
  wrappedItemKey: 'w',
  ciphertext: 'c',
  version: 1,
  rev: 0,
  updatedAt: 5,
  deletedAt: null,
  dirty: 1 as const,
  ...over,
});

describe('SqliteStore', () => {
  it('stores, updates and deletes items', async () => {
    const s = await SqliteStore.open(memoryDb());
    await s.putItem(item('a'));
    await s.putItem(item('b', { deletedAt: 9, dirty: 0 }));
    expect(await s.getItem('a')).toMatchObject({ id: 'a', dirty: 1, deletedAt: null });
    await s.updateItem('a', { rev: 3, dirty: 0, deletedAt: 12 });
    expect(await s.getItem('a')).toMatchObject({ rev: 3, dirty: 0, deletedAt: 12 });
    await s.updateItem('a', {});
    await s.updateItem('a', { 'id = id; DROP TABLE items; --': 1 } as never);
    expect((await s.listItems()).map((i) => i.id).sort()).toEqual(['a', 'b']);
    await s.deleteItems(['a', 'b']);
    expect(await s.getItem('a')).toBeUndefined();
  });

  it('stores vaults and the ordered outbox', async () => {
    const s = await SqliteStore.open(memoryDb());
    await s.putVault({
      id: 'v',
      wrappedVaultKey: 'k',
      encMeta: 'm',
      rev: 0,
      deletedAt: null,
      dirty: 1,
    });
    await s.updateVault('v', { rev: 4, dirty: 0 });
    expect(await s.getVault('v')).toMatchObject({ rev: 4, dirty: 0 });
    expect(await s.listVaults()).toHaveLength(1);

    await s.addOutbox({ kind: 'item', id: 'a', baseRev: 0 });
    await s.addOutbox({ kind: 'vault', id: 'v', baseRev: 4 });
    await s.updateOutbox(1, { baseRev: 7 });
    expect((await s.listOutbox()).map((o) => [o.seq, o.baseRev])).toEqual([
      [1, 7],
      [2, 4],
    ]);
    expect(await s.findOutbox('vault', 'v')).toMatchObject({ seq: 2 });
    expect(await s.getOutbox(1)).toMatchObject({ id: 'a' });
    await s.deleteOutbox(1);
    expect(await s.getOutbox(1)).toBeUndefined();
  });

  it('keeps meta as JSON and clears everything', async () => {
    const s = await SqliteStore.open(memoryDb());
    await s.setMeta('account', { email: 'x', n: [1, 2] });
    expect(await s.getMeta('account')).toEqual({ email: 'x', n: [1, 2] });
    expect(await s.getMeta('nope')).toBeUndefined();
    await s.putItem(item('a'));
    await s.clearAll();
    expect(await s.listItems()).toEqual([]);
    expect(await s.getMeta('account')).toBeUndefined();
  });

  it('commits transactions and rolls back on error', async () => {
    const s = await SqliteStore.open(memoryDb());
    await s.transaction(async () => {
      await s.putItem(item('a'));
      await s.addOutbox({ kind: 'item', id: 'a', baseRev: 0 });
    });
    await expect(
      s.transaction(async () => {
        await s.putItem(item('b'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await s.getItem('a')).toBeDefined();
    expect(await s.getItem('b')).toBeUndefined();
  });

  it('serialises overlapping transactions', async () => {
    const s = await SqliteStore.open(memoryDb());
    const order: string[] = [];
    await Promise.all([
      s.transaction(async () => {
        order.push('a1');
        await new Promise((r) => setTimeout(r, 10));
        order.push('a2');
      }),
      s.transaction(async () => void order.push('b')),
    ]);
    expect(order).toEqual(['a1', 'a2', 'b']);
  });
});

describe('the shared sync engine on SQLite', () => {
  beforeAll(() =>
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
    ),
  );
  afterAll(() => setArgon2Implementation(null));

  it('syncs an Android-style client with another device end to end', async () => {
    const server = new FakeServer();
    const phone = createTestClient(server, { store: await SqliteStore.open(memoryDb()) });
    await phone.account.createNewAccount({
      email: 'me@example.com',
      password: 'a long passphrase',
      serverUrl: 'https://vault.test',
    });
    await phone.account.confirmRecoveryKit();
    await phone.sync.syncOnce();
    const vaultId = (await phone.vault.loadVault()).vaults[0]!.id;

    const id = await phone.vault.saveItem(
      vaultId,
      itemSchema.parse({
        type: 'login',
        title: 'Bank',
        password: 'pw-from-android',
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    expect((await phone.sync.syncOnce()).pushed).toBe(1);

    const laptop = createTestClient(server);
    await laptop.account.signIn({
      email: 'me@example.com',
      password: 'a long passphrase',
      serverUrl: 'https://vault.test',
    });
    await laptop.sync.syncOnce();
    const seen = (await laptop.vault.loadVault()).items.find((i) => i.id === id)!;
    expect((seen.item as LoginItem).password).toBe('pw-from-android');

    // And back: an edit on the laptop reaches the phone's SQLite database.
    await laptop.vault.saveLoginEdit(seen, { password: 'rotated' });
    await laptop.sync.syncOnce();
    await phone.sync.syncOnce();
    const back = (await phone.vault.loadVault()).items.find((i) => i.id === id)!;
    expect((back.item as LoginItem).password).toBe('rotated');
  });
});
