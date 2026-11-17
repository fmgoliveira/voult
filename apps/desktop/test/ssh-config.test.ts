import { readFileSync } from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ItemView } from '@voult/core';
import {
  ensureInclude,
  GENERATED_HEADER,
  INCLUDE_LINE,
  INCLUDE_MARKER,
  publicKeyFileName,
  renderConfig,
  writeSshConfig,
} from '../src/ssh/config';
import { generateEd25519, sshHostItem, sshKeyItem } from './helpers';

let n = 0;
const view = (
  item: ItemView['item'],
  id = `i${n++}`,
  deletedAt: number | null = null,
): ItemView => ({
  id,
  vaultId: 'v',
  item,
  deletedAt,
  dirty: false,
});

const key = generateEd25519('me@laptop');
const keyView = view(sshKeyItem(key, { title: 'Deploy' }), 'key1');
const host = (over: Record<string, unknown> = {}, id?: string) =>
  view(sshHostItem({ keyItemId: 'key1', ...over }), id);

describe('renderConfig', () => {
  it('writes a block per host with the .pub identity and IdentitiesOnly', () => {
    const r = renderConfig([
      keyView,
      host({ alias: 'box', hostname: 'box.example.com', username: 'deploy', port: 2222 }),
    ]);
    const file = publicKeyFileName(key.fingerprint);
    expect(file).toMatch(/^[A-Za-z0-9_-]{43}\.pub$/);
    expect(r.config).toBe(
      [
        GENERATED_HEADER,
        '',
        'Host box',
        '  HostName box.example.com',
        '  Port 2222',
        '  User deploy',
        `  IdentityFile ~/.ssh/voult/${file}`,
        '  IdentitiesOnly yes',
        '',
      ].join('\n'),
    );
    expect(r.hosts).toEqual(['box']);
    expect([...r.publicKeys.keys()]).toEqual([file]);
    expect(r.publicKeys.get(file)).toBe(`${key.publicKey}\n`);
    expect(r.warnings).toEqual([]);
  });

  it('never writes private keys or passwords', () => {
    const r = renderConfig([
      keyView,
      host({ alias: 'pw', auth: 'keyAndPassword', password: 'hunter2-secret' }),
    ]);
    const all = r.config + [...r.publicKeys.values()].join('');
    expect(all).not.toContain('hunter2-secret');
    expect(all).not.toContain('PRIVATE KEY');
  });

  it('handles each auth mode', () => {
    const pw = renderConfig([host({ alias: 'p', auth: 'password' })]).config;
    expect(pw).toContain('PubkeyAuthentication no');
    expect(pw).toContain('PreferredAuthentications password,keyboard-interactive');
    expect(pw).not.toContain('IdentityFile');
    const both = renderConfig([keyView, host({ alias: 'b', auth: 'keyAndPassword' })]).config;
    expect(both).toContain('IdentityFile');
    expect(both).toContain('PreferredAuthentications publickey,password,keyboard-interactive');
  });

  it('skips unsafe aliases and host names, with a warning each', () => {
    const r = renderConfig([
      host({ alias: 'ok' }),
      host({ alias: 'bad alias' }),
      host({ alias: 'x\nHost evil' }),
      host({ alias: '-oProxyCommand=evil' }),
      host({ alias: 'h1', hostname: 'a b' }),
      host({ alias: 'h2', hostname: 'a\nProxyCommand evil' }),
      host({ alias: 'h3', hostname: '' }),
    ]);
    expect(r.hosts).toEqual(['ok']);
    expect(r.warnings.filter((w) => /Skipped/.test(w))).toHaveLength(6);
    expect(r.config).not.toContain('evil');
  });

  it('skips a duplicate alias', () => {
    const r = renderConfig([host({ alias: 'same' }), host({ alias: 'same' })]);
    expect(r.hosts).toEqual(['same']);
    expect(r.warnings[0]).toMatch(/duplicate/);
  });

  it('ignores trashed items and warns when a key is missing', () => {
    const r = renderConfig([
      view(sshHostItem({ alias: 'gone' }), 'g', 5),
      host({ alias: 'nokey', keyItemId: 'missing' }),
      view(sshKeyItem(generateEd25519('t')), 'trashed-key', 5),
    ]);
    expect(r.hosts).toEqual(['nokey']);
    expect(r.warnings[0]).toMatch(/key was not found/);
    expect(r.publicKeys.size).toBe(0);
  });

  it('passes through extra options, dropping structure and command options', () => {
    const extra = [
      'ServerAliveInterval 30',
      '# a comment',
      '',
      'Compression=yes',
      'ProxyCommand nc %h %p',
      'LocalCommand evil.exe',
      'Host injected',
      'Match all',
      'Include other',
      'not an option',
    ].join('\n');
    const r = renderConfig([host({ alias: 'e', extraOptions: extra })]);
    expect(r.config).toContain('  ServerAliveInterval 30');
    expect(r.config).toContain('  Compression yes');
    for (const bad of [
      'ProxyCommand',
      'LocalCommand',
      'Host injected',
      'Match',
      'Include',
      'not an',
    ]) {
      expect(r.config).not.toContain(bad);
    }
    expect(r.warnings.filter((w) => /runs a program/.test(w))).toHaveLength(2);

    const allowed = renderConfig([host({ alias: 'e', extraOptions: 'ProxyCommand nc %h %p' })], {
      allowCommandOptions: true,
    });
    expect(allowed.config).toContain('  ProxyCommand nc %h %p');
  });

  it('writes ProxyJump for aliases and user@host, and drops unsafe ones', () => {
    const r = renderConfig([
      host({ alias: 'bastion', hostname: 'bastion.example.com' }),
      host({ alias: 'inner', hostname: '10.0.0.5', proxyJump: 'bastion' }),
      host({
        alias: 'ext',
        hostname: 'x.example.com',
        proxyJump: 'me@jump.example.com:2200,bastion',
      }),
      host({ alias: 'bad', hostname: 'y.example.com', proxyJump: 'a b' }),
      host({ alias: 'opt', hostname: 'z.example.com', proxyJump: '-oProxyCommand=x' }),
    ]);
    expect(r.config).toContain('Host inner\n  HostName 10.0.0.5\n  Port 22\n  ProxyJump bastion');
    expect(r.config).toContain('  ProxyJump me@jump.example.com:2200,bastion');
    expect(r.config).not.toContain('ProxyJump a b');
    expect(r.config).not.toContain('-oProxyCommand');
    expect(r.warnings.filter((w) => /jump host/.test(w))).toHaveLength(2);
  });

  it('ignores user names with spaces', () => {
    const r = renderConfig([host({ alias: 'u', username: 'a b' })]);
    expect(r.config).not.toContain('User');
    expect(r.warnings[0]).toMatch(/user name/);
  });

  it('is deterministic and sorted by alias', () => {
    const a = renderConfig([host({ alias: 'b' }), host({ alias: 'a' })]);
    const b = renderConfig([host({ alias: 'a' }), host({ alias: 'b' })]);
    expect(a.config).toBe(b.config);
    expect(a.hosts).toEqual(['a', 'b']);
  });

  it('writes only the header when there are no hosts', () => {
    expect(renderConfig([]).config).toBe(GENERATED_HEADER + '\n');
  });
});

describe('publicKeyFileName', () => {
  it('is filesystem safe', () => {
    expect(publicKeyFileName('SHA256:ab/cd+ef')).toBe('ab_cd-ef.pub');
  });
});

describe('ensureInclude', () => {
  const block = `${INCLUDE_MARKER}\n${INCLUDE_LINE}\n`;

  it('adds the Include above everything, keeping the rest byte for byte', () => {
    const original = 'Host a\r\n  User x\n\tHostName  y \n\n# end';
    const out = ensureInclude(original);
    // The new lines follow the file's CRLF style; every original byte (mixed endings too) survives.
    expect(out.startsWith(`${INCLUDE_MARKER}\r\n${INCLUDE_LINE}\r\n\r\n`)).toBe(true);
    expect(out.endsWith(original)).toBe(true);
  });

  it('uses CRLF when the file does', () => {
    const out = ensureInclude('Host a\r\n  User x\r\n');
    expect(out.startsWith(`${INCLUDE_MARKER}\r\n${INCLUDE_LINE}\r\n`)).toBe(true);
  });

  it('creates the lines for an empty file', () => {
    expect(ensureInclude('')).toBe(block);
  });

  it('is idempotent', () => {
    const once = ensureInclude('Host a\n  User x\n');
    expect(ensureInclude(once)).toBe(once);
    expect(ensureInclude(ensureInclude(once))).toBe(once);
  });

  it('accepts the Include already being first, with or without the marker or leading blanks', () => {
    for (const t of [
      `${INCLUDE_LINE}\nHost a\n`,
      `\n\n  include voult/config\nHost a\n`,
      `${INCLUDE_MARKER}\n${INCLUDE_LINE}\nHost a\n`,
    ]) {
      expect(ensureInclude(t)).toBe(t);
    }
  });

  it('moves a misplaced Include to the top without touching other lines', () => {
    const original = `Host a\n  User x\n${INCLUDE_MARKER}\n${INCLUDE_LINE}\nHost b\n  User y\n`;
    const out = ensureInclude(original);
    expect(out.split('\n').slice(0, 2)).toEqual([INCLUDE_MARKER, INCLUDE_LINE]);
    expect(out.match(/Include voult\/config/g)).toHaveLength(1);
    expect(out.replace(`${block}\n`, '')).toBe('Host a\n  User x\nHost b\n  User y\n');
  });
});

describe('writeSshConfig', () => {
  const setup = () => {
    const ssh = mkdtempSync(path.join(tmpdir(), 'voult-sshdir-'));
    return { ssh, lockDown: async () => undefined };
  };
  const items = [keyView, host({ alias: 'box', hostname: 'box.example.com' })];

  it('creates the config, the .pub file and the Include', async () => {
    const { ssh, lockDown } = setup();
    const r = await writeSshConfig(ssh, items, { lockDown });
    expect(r.changed).toBe(true);
    const dir = path.join(ssh, 'voult');
    expect(readdirSync(dir).sort()).toEqual(['config', publicKeyFileName(key.fingerprint)].sort());
    expect(readFileSync(path.join(dir, 'config'), 'utf8')).toContain('Host box');
    expect(readFileSync(path.join(ssh, 'config'), 'utf8')).toBe(block());
  });

  it('is idempotent and preserves an existing config', async () => {
    const { ssh, lockDown } = setup();
    const existing = 'Host work\n  HostName w.example.com\n';
    writeFileSync(path.join(ssh, 'config'), existing);
    await writeSshConfig(ssh, items, { lockDown });
    const first = readFileSync(path.join(ssh, 'config'), 'utf8');
    expect(first.endsWith(existing)).toBe(true);
    const again = await writeSshConfig(ssh, items, { lockDown });
    expect(again.changed).toBe(false);
    expect(readFileSync(path.join(ssh, 'config'), 'utf8')).toBe(first);
  });

  it('removes .pub files and blocks of deleted hosts, and leaves other files alone', async () => {
    const { ssh, lockDown } = setup();
    await writeSshConfig(ssh, items, { lockDown });
    const dir = path.join(ssh, 'voult');
    writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
    const r = await writeSshConfig(ssh, [keyView], { lockDown });
    expect(r.changed).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['config', 'notes.txt']);
    expect(readFileSync(path.join(dir, 'config'), 'utf8')).not.toContain('Host box');
  });

  it('works when ~/.ssh does not exist yet', async () => {
    const { ssh, lockDown } = setup();
    const nested = path.join(ssh, 'new', '.ssh');
    mkdirSync(path.dirname(nested), { recursive: true });
    await writeSshConfig(nested, items, { lockDown });
    expect(existsSync(path.join(nested, 'config'))).toBe(true);
  });
});

function block() {
  return `${INCLUDE_MARKER}\n${INCLUDE_LINE}\n`;
}
