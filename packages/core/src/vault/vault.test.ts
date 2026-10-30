import { describe, expect, it } from 'vitest';
import { newKey } from '../crypto/keys';
import {
  createVault,
  decryptItem,
  encryptItem,
  isPurgeable,
  newId,
  openVault,
  pushPasswordHistory,
  resolveConflict,
  TRASH_RETENTION_MS,
  updateLogin,
} from './ops';
import { itemSchema, type Item, type LoginItem } from './schemas';

const login = (over: Partial<LoginItem> = {}): LoginItem =>
  itemSchema.parse({
    type: 'login',
    title: 'GitHub',
    password: 'p1',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as LoginItem;

describe('schemas', () => {
  it('applies defaults for every item type', () => {
    const base = { title: 't', createdAt: 1, updatedAt: 1 };
    for (const type of ['login', 'note', 'card', 'identity'] as const) {
      expect(itemSchema.parse({ ...base, type }).type).toBe(type);
    }
    const t = itemSchema.parse({ ...base, type: 'totp', totp: { secret: 'JBSWY3DPEHPK3PXP' } });
    expect(t.type === 'totp' && t.totp).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });
  });
  it('rejects unknown types and bad totp values', () => {
    expect(() => itemSchema.parse({ type: 'nope' })).toThrow();
    expect(() =>
      login({ totp: { secret: 's', digits: 9 } as never, urls: [{ url: 'a' }] as never }),
    ).toThrow();
  });
  it('accepts urls, custom fields and passkeys on a login', () => {
    const l = login({
      urls: [{ url: 'https://a.com', match: 'host' }, { url: 'b.com' }] as never,
      customFields: [
        { type: 'text', name: 'a', value: 'b' },
        { type: 'totp', name: 'c', value: { secret: 'S' } },
      ] as never,
    });
    expect(l.urls[1]!.match).toBe('domain');
    expect(l.customFields).toHaveLength(2);
  });
});

describe('vault + item encryption', () => {
  it('creates and reopens a vault with metadata', () => {
    const account = newKey();
    const { record, vaultKey } = createVault(account, { name: 'Personal' });
    const opened = openVault(account, record);
    expect(opened.meta).toEqual({ name: 'Personal', colour: '#4f46e5', icon: 'lock' });
    expect(opened.vaultKey).toEqual(vaultKey);
    expect(() => openVault(newKey(), record)).toThrow();
    expect(() => openVault(account, { ...record, id: newId() })).toThrow();
  });

  it('round-trips items and binds id + version', () => {
    const vaultKey = newKey();
    const item = login({ notes: 'héllo' });
    const rec = encryptItem(vaultKey, 'id1', 3, item);
    expect(rec.ciphertext).not.toContain('GitHub');
    expect(decryptItem(vaultKey, 'id1', 3, rec)).toEqual(item);
    expect(() => decryptItem(vaultKey, 'id2', 3, rec)).toThrow();
    expect(() => decryptItem(vaultKey, 'id1', 2, rec)).toThrow();
    expect(() => decryptItem(newKey(), 'id1', 3, rec)).toThrow();
  });

  it('uses a distinct item key per write', () => {
    const vaultKey = newKey();
    const a = encryptItem(vaultKey, 'x', 1, login());
    const b = encryptItem(vaultKey, 'x', 1, login());
    expect(a.wrappedItemKey).not.toBe(b.wrappedItemKey);
  });
});

describe('password history', () => {
  it('keeps the last 10, newest first, ignores empty', () => {
    let h: LoginItem['passwordHistory'] = [];
    for (let i = 0; i < 15; i++) h = pushPasswordHistory(h, `p${i}`, i);
    expect(h).toHaveLength(10);
    expect(h[0]!.password).toBe('p14');
    expect(pushPasswordHistory(h, '', 99)).toBe(h);
  });
  it('updateLogin records the old password only when it changes', () => {
    const l = login();
    const same = updateLogin(l, { title: 'x' }, 5);
    expect(same.passwordHistory).toEqual([]);
    expect(same.updatedAt).toBe(5);
    const changed = updateLogin(l, { password: 'p2' }, 6);
    expect(changed.passwordHistory).toEqual([{ password: 'p1', changedAt: 6 }]);
    expect(updateLogin(l, { password: 'p1' }, 7).passwordHistory).toEqual([]);
  });
});

describe('conflict resolution', () => {
  it('last writer wins and the losing password is kept in history', () => {
    const local = login({ password: 'local', updatedAt: 10 });
    const remote = login({ password: 'remote', updatedAt: 5 });
    const merged = resolveConflict(local, remote) as LoginItem;
    expect(merged.password).toBe('local');
    expect(merged.passwordHistory[0]).toEqual({ password: 'remote', changedAt: 5 });
    const flipped = resolveConflict(remote, local) as LoginItem;
    expect(flipped.password).toBe('local');
  });
  it('does not touch history when passwords match or items are not logins', () => {
    const a = login({ updatedAt: 2 });
    const b = login({ title: 'older', updatedAt: 1 });
    expect(resolveConflict(a, b)).toBe(a);
    const n1 = itemSchema.parse({ type: 'note', title: 'a', createdAt: 1, updatedAt: 2 }) as Item;
    const n2 = itemSchema.parse({ type: 'note', title: 'b', createdAt: 1, updatedAt: 1 }) as Item;
    expect(resolveConflict(n1, n2)).toBe(n1);
  });
});

describe('trash', () => {
  it('purges after 30 days', () => {
    expect(isPurgeable(0, TRASH_RETENTION_MS - 1)).toBe(false);
    expect(isPurgeable(0, TRASH_RETENTION_MS)).toBe(true);
  });
});
