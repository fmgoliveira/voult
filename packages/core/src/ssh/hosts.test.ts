import { describe, expect, it } from 'vitest';
import { blankItem } from '../client/blank-item';
import type { ItemView } from '../client/types';
import {
  hostUsesKey,
  hostUsesPassword,
  sshCommand,
  sshKeyChoices,
  sshKeyFilename,
  takenAliases,
  validateAlias,
} from './hosts';

const view = (id: string, item: object, deletedAt: number | null = null): ItemView => ({
  id,
  vaultId: 'v',
  item: item as never,
  deletedAt,
  dirty: false,
});

describe('validateAlias', () => {
  it('accepts plain aliases', () => {
    for (const a of ['box', 'prod-1', 'a.b_c', 'X9']) expect(validateAlias(a, [])).toBeNull();
  });
  it('rejects empty, special characters, spaces and a leading dash', () => {
    expect(validateAlias('', [])).toBe('empty');
    for (const a of ['a b', 'a*', 'a?', 'a!b', 'a@b', 'ü', '-x', '--help', 'a/b', 'a\nb']) {
      expect(validateAlias(a, [])).toBe('invalid');
    }
  });
  it('rejects a duplicate', () => {
    expect(validateAlias('box', ['other', 'box'])).toBe('duplicate');
    expect(validateAlias('box', ['Box'])).toBeNull();
  });
});

describe('takenAliases', () => {
  const host = (alias: string) => ({ ...blankItem('sshHost'), alias });
  const items = [
    view('1', host('a')),
    view('2', host('b')),
    view('3', host('trashed'), 5),
    view('4', blankItem('note')),
  ];
  it('lists live host aliases and can skip the host being edited', () => {
    expect(takenAliases(items)).toEqual(['a', 'b']);
    expect(takenAliases(items, '1')).toEqual(['b']);
  });
});

describe('helpers', () => {
  it('builds the ssh command line', () => {
    expect(sshCommand({ hostname: 'h.io', username: '', port: 22 })).toBe('ssh h.io');
    expect(sshCommand({ hostname: 'h.io', username: 'me', port: 22 })).toBe('ssh me@h.io');
    expect(sshCommand({ hostname: 'h.io', username: 'me', port: 2222 })).toBe(
      'ssh me@h.io -p 2222',
    );
  });
  it('names key files', () => {
    expect(sshKeyFilename('ed25519')).toBe('id_ed25519');
    expect(sshKeyFilename('rsa')).toBe('id_rsa');
    expect(sshKeyFilename('ecdsa-p384')).toBe('id_ecdsa');
  });
  it('lists live keys only', () => {
    const items = [
      view('k', blankItem('sshKey')),
      view('t', blankItem('sshKey'), 1),
      view('n', blankItem('note')),
    ];
    expect(sshKeyChoices(items).map((v) => v.id)).toEqual(['k']);
  });
  it('knows which credentials a host uses', () => {
    expect([hostUsesKey({ auth: 'key' }), hostUsesPassword({ auth: 'key' })]).toEqual([
      true,
      false,
    ]);
    expect([hostUsesKey({ auth: 'password' }), hostUsesPassword({ auth: 'password' })]).toEqual([
      false,
      true,
    ]);
    expect([
      hostUsesKey({ auth: 'keyAndPassword' }),
      hostUsesPassword({ auth: 'keyAndPassword' }),
    ]).toEqual([true, true]);
  });
});
