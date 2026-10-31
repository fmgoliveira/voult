import { describe, expect, it } from 'vitest';
import { blankItem } from './blank-item';
import { androidAppUrl, buildAutofillIndex, packageOfUrl } from './autofill-index';
import type { ItemView } from './types';
import type { LoginItem } from '../vault/schemas';

const view = (
  id: string,
  patch: Partial<LoginItem>,
  deletedAt: number | null = null,
): ItemView => ({
  id,
  vaultId: 'v',
  item: { ...(blankItem('login') as LoginItem), title: id, ...patch },
  deletedAt,
  dirty: false,
});

describe('buildAutofillIndex', () => {
  it('turns url rules into match keys and never includes secrets', () => {
    const idx = buildAutofillIndex([
      view('gh', {
        username: 'alice',
        password: 'hunter2',
        urls: [
          { url: 'https://login.github.com/session', match: 'domain' },
          { url: 'https://api.example.com', match: 'host' },
          { url: 'https://bad.github.com', match: 'never' },
          { url: '^https://x', match: 'regex' },
          { url: androidAppUrl('com.github.android'), match: 'domain' },
        ],
      }),
    ]);
    expect(idx.logins).toEqual([
      {
        id: 'gh',
        title: 'gh',
        username: 'alice',
        domains: ['github.com'],
        hosts: ['api.example.com'],
        never: ['bad.github.com'],
        packages: ['com.github.android'],
      },
    ]);
    expect(JSON.stringify(idx)).not.toContain('hunter2');
  });

  it('skips trashed items, other types and empty logins; lists passkeys', () => {
    const idx = buildAutofillIndex([
      view('gone', { username: 'a' }, 5),
      view('empty', {}),
      view('pk', {
        passkeys: [
          {
            credentialId: 'cred',
            rpId: 'example.com',
            rpName: 'Example',
            userHandle: 'h',
            userName: 'bob',
            privateKey: 'SECRET',
            signCount: 0,
            createdAt: 7,
          },
        ],
      }),
    ]);
    expect(idx.logins).toHaveLength(0);
    expect(idx.passkeys).toEqual([
      {
        itemId: 'pk',
        credentialId: 'cred',
        rpId: 'example.com',
        userName: 'bob',
        title: 'pk',
        createdAt: 7,
      },
    ]);
    expect(JSON.stringify(idx)).not.toContain('SECRET');
  });

  it('round-trips package urls', () => {
    expect(packageOfUrl(androidAppUrl('a.b'))).toBe('a.b');
    expect(packageOfUrl('https://a.b')).toBeNull();
  });
});
