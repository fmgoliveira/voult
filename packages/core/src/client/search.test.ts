import { describe, expect, it } from 'vitest';
import { itemSchema } from '../vault/schemas';
import { hostOf, matchesText, queryItems, type ListQuery } from './search';
import { blankItem } from './blank-item';
import { normalizeServerUrl } from './server-url';
import { parseTotpInput } from './totp-input';
import type { ItemView } from './types';

const view = (
  id: string,
  over: Record<string, unknown>,
  deletedAt: number | null = null,
  vaultId = 'v1',
): ItemView => ({
  id,
  vaultId,
  deletedAt,
  dirty: false,
  item: itemSchema.parse({ type: 'login', title: id, createdAt: 1, updatedAt: 1, ...over }),
});

const base: ListQuery = { text: '', type: 'all', vaultId: 'all', sort: 'title', trash: false };

describe('search', () => {
  const items = [
    view('b-github', { username: 'octo', urls: [{ url: 'https://github.com/login' }] }),
    view('a-bank', { email: 'me@bank.com', notes: 'savings account', favorite: true }),
    view('c-pinned', { pinned: true }),
    view('d-trash', {}, Date.now() - 1000),
    view('e-other-vault', {}, null, 'v2'),
    view('f-purged', {}, 1),
    {
      ...view('g-note', {}),
      item: itemSchema.parse({
        type: 'note',
        title: 'g-note',
        notes: 'wifi password',
        createdAt: 1,
        updatedAt: 5,
      }),
    },
  ];
  const ids = (q: Partial<ListQuery>) => queryItems(items, { ...base, ...q }).map((v) => v.id);

  it('matches title, username, url and notes, all terms required', () => {
    expect(ids({ text: 'octo' })).toEqual(['b-github']);
    expect(ids({ text: 'github.com' })).toEqual(['b-github']);
    expect(ids({ text: 'SAVINGS bank' })).toEqual(['a-bank']);
    expect(matchesText(items[0]!, '   ')).toBe(true);
    expect(ids({ text: 'nothing-here' })).toEqual([]);
  });
  it('orders pinned, then favourites, then by sort key', () => {
    expect(ids({})).toEqual(['c-pinned', 'a-bank', 'b-github', 'e-other-vault', 'g-note']);
    expect(ids({ sort: 'updated' })[2]).toBe('g-note');
  });
  it('filters by type, vault and trash; hides purged items', () => {
    expect(ids({ type: 'note' })).toEqual(['g-note']);
    expect(ids({ vaultId: 'v2' })).toEqual(['e-other-vault']);
    expect(ids({ trash: true })).toEqual(['d-trash']);
  });
  it('hostOf handles bare domains and junk', () => {
    expect(hostOf('example.com/path')).toBe('example.com');
    expect(hostOf('https://a.b.org')).toBe('a.b.org');
  });
});

describe('totp input', () => {
  it('accepts bare secrets and otpauth links', () => {
    expect(parseTotpInput('', undefined)).toBeUndefined();
    expect(parseTotpInput('abcd efgh', undefined)?.secret).toBe('ABCDEFGH');
    expect(parseTotpInput('otpauth://totp/x:y?secret=ABC&issuer=x', undefined)).toMatchObject({
      issuer: 'x',
      account: 'y',
    });
  });
});

describe('normalizeServerUrl', () => {
  it('requires https except on loopback and strips paths', () => {
    expect(normalizeServerUrl(' https://vault.example.com/x/y ')).toBe('https://vault.example.com');
    expect(normalizeServerUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServerUrl('http://127.0.0.1:1')).toBe('http://127.0.0.1:1');
    expect(() => normalizeServerUrl('http://vault.example.com')).toThrow('https');
    expect(() => normalizeServerUrl('nonsense')).toThrow();
  });
});

describe('blankItem', () => {
  it('produces a valid-shaped empty item for every type', () => {
    for (const type of ['login', 'note', 'card', 'identity', 'totp'] as const) {
      const i = blankItem(type);
      expect(i.type).toBe(type);
      expect(i.title).toBe('');
    }
    const t = blankItem('totp');
    expect(t.type === 'totp' && t.totp.algorithm).toBe('SHA1');
  });
});
