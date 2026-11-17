import { parsePrivateKey, setArgon2Implementation, type ParsedSshKey } from '@voult/core';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeSshConfig } from '../src/ssh/config';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import ssh2 from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentExtension } from '../src/agent';
import { resolveSsh } from '../src/agent/doctor';
import { startDaemon, type Daemon } from '../src/daemon';
import { fakeDpapi } from '../src/dpapi';
import {
  EMAIL,
  PASSWORD,
  SERVER_URL,
  generateEd25519,
  seededServer,
  sshHostItem,
  sshKeyItem,
  tempPaths,
  useCheapArgon2,
} from './helpers';

/**
 * End to end on Windows: the real OpenSSH client talks to the agent over a named pipe and signs in
 * to a throwaway SSH server (the pure-JS `ssh2` server), once per key type.
 */
const FIXTURES = path.resolve(__dirname, '../../../packages/core/test/fixtures/ssh');
const fixture = (n: string) => parsePrivateKey(readFileSync(path.join(FIXTURES, n), 'utf8'));

const { Server, utils } = ssh2;
const win = process.platform === 'win32';
const pipe = `\\\\.\\pipe\\voult-agent-test-${randomBytes(6).toString('hex')}`;

const run = (file: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(
      file,
      args,
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 30_000 },
      (e, out, err) =>
        resolve({
          code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
          out: String(out),
          err: String(err),
        }),
    );
  });

/** An SSH server that accepts exactly one public key and answers `exec` with "hello". */
function sshServer(accept: () => ParsedSshKey, offered: string[] = []) {
  const host = fixture('ed25519');
  const server = new Server({ hostKeys: [host.privateKey] }, (client) => {
    client
      .on('authentication', (ctx) => {
        if (ctx.method !== 'publickey') return ctx.reject(['publickey']);
        if (!ctx.signature) offered.push(ctx.key.algo + ':' + ctx.key.data.toString('base64'));
        const allowed = utils.parseKey(accept().publicKey);
        if (allowed instanceof Error) return ctx.reject();
        const same =
          ctx.key.algo === allowed.type &&
          Buffer.compare(ctx.key.data, allowed.getPublicSSH()) === 0;
        if (!same) return ctx.reject();
        if (ctx.signature && allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) !== true) {
          return ctx.reject();
        }
        ctx.accept();
      })
      .on('ready', () =>
        client.on('session', (accept) =>
          accept().on('exec', (acceptExec) => {
            const stream = acceptExec();
            stream.write('hello\n');
            stream.exit(0);
            stream.end();
          }),
        ),
      )
      .on('error', () => undefined);
  });
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() }),
    );
  });
}

describe.skipIf(!win)('SSH agent with the real OpenSSH client', () => {
  let daemon: Daemon;
  let ssh: string;
  let current: ParsedSshKey;
  const confirmCalls: string[] = [];
  let allow = true;
  const keys: Record<string, ParsedSshKey> = {};

  beforeAll(async () => {
    useCheapArgon2();
    ssh = await resolveSsh();
    keys.ed25519 = generateEd25519('agent-ed25519');
    keys.rsa = fixture('rsa3072');
    keys.p256 = fixture('ecdsa256');
    keys.p384 = fixture('ecdsa384');
    keys.confirm = generateEd25519('needs-confirm');
    const { server } = await seededServer([
      sshKeyItem(keys.ed25519, { title: 'ed25519' }),
      sshKeyItem(keys.rsa, { title: 'rsa' }),
      sshKeyItem(keys.p256, { title: 'p256' }),
      sshKeyItem(keys.p384, { title: 'p384' }),
      sshKeyItem(keys.confirm, { title: 'confirm', agent: { enabled: true, confirm: true } }),
    ]);
    const paths = tempPaths();
    daemon = await startDaemon({
      paths,
      dpapi: fakeDpapi,
      pipe: `\\\\.\\pipe\\voult-cli-test-${randomBytes(6).toString('hex')}`,
      fetch: ((i: string | URL | Request, n?: RequestInit) => server.fetch(i, n)) as typeof fetch,
      extend: agentExtension({
        paths,
        pipe,
        confirm: async (k) => {
          confirmCalls.push(k.title);
          return allow;
        },
        notifyLocked: () => undefined,
      }),
    });
    await daemon.runtime.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
  }, 60_000);

  afterAll(async () => {
    await daemon?.stop();
    setArgon2Implementation(null);
  });

  const sshTo = async (port: number) =>
    run(
      ssh,
      [
        '-F',
        'NUL',
        '-T',
        '-p',
        String(port),
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'UserKnownHostsFile=NUL',
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentityFile=NUL',
        '-o',
        'PreferredAuthentications=publickey',
        'tester@127.0.0.1',
        'true',
      ],
      { SSH_AUTH_SOCK: pipe },
    );

  it('ssh-add -L lists the agent keys (and only those with the agent enabled)', async () => {
    const add = path.join(path.dirname(ssh), 'ssh-add.exe');
    const r = await run(add, ['-L'], { SSH_AUTH_SOCK: pipe });
    expect(r.code).toBe(0);
    const lines = r.out.trim().split(/\r?\n/);
    expect(lines).toHaveLength(5);
    for (const k of Object.values(keys)) {
      expect(lines.some((l) => l.startsWith(k.publicKey.split(' ').slice(0, 2).join(' ')))).toBe(
        true,
      );
    }
  }, 40_000);

  it.each(['ed25519', 'rsa', 'p256', 'p384'])(
    'signs in with a %s key',
    async (name) => {
      current = keys[name]!;
      const srv = await sshServer(() => current);
      try {
        const r = await sshTo(srv.port);
        expect(r.err).not.toMatch(/Permission denied/);
        expect(r.code).toBe(0);
      } finally {
        srv.close();
      }
    },
    60_000,
  );

  it('asks before signing with a confirm key, and a denial means no signature', async () => {
    current = keys.confirm!;
    const srv = await sshServer(() => current);
    try {
      allow = false;
      confirmCalls.length = 0;
      const denied = await sshTo(srv.port);
      expect(denied.code).not.toBe(0);
      expect(denied.err).toMatch(/Permission denied/);
      expect(confirmCalls).toContain('confirm');

      allow = true;
      const ok = await sshTo(srv.port);
      expect(ok.code).toBe(0);
    } finally {
      allow = true;
      srv.close();
    }
  }, 60_000);

  it('answers with no keys once locked, so ssh cannot sign in', async () => {
    daemon.runtime.lock();
    current = keys.ed25519!;
    const srv = await sshServer(() => current);
    try {
      const add = path.join(path.dirname(ssh), 'ssh-add.exe');
      const list = await run(add, ['-L'], { SSH_AUTH_SOCK: pipe });
      expect(list.out + list.err).toMatch(/no identities/);
      const r = await sshTo(srv.port);
      expect(r.code).not.toBe(0);
    } finally {
      srv.close();
    }
    await daemon.runtime.unlock(PASSWORD);
    expect(daemon.runtime.keyring.size).toBe(5);
  }, 60_000);

  it('a host written by `voult ssh config` connects through the agent offering only its key', async () => {
    const sshDir = mkdtempSync(path.join(tmpdir(), 'voult-sshcfg-'));
    const items = await daemon.runtime.loadItems();
    const target = items.find((v) => v.item.type === 'sshKey' && v.item.title === 'p256')!;
    const hostItem = {
      ...sshHostItem({
        alias: 'agenthost',
        hostname: '127.0.0.1',
        username: 'tester',
        keyItemId: target.id,
      }),
    };
    const view = { id: 'h1', vaultId: 'v', item: hostItem, deletedAt: null, dirty: false };
    await writeSshConfig(sshDir, [...items, view], { lockDown: async () => undefined });

    // `~/.ssh/voult` is the real home on this machine; point the generated paths at the temp dir.
    const dir = path.join(sshDir, 'voult').replaceAll(String.fromCharCode(92), '/');
    const generated = readFileSync(path.join(sshDir, 'voult', 'config'), 'utf8').replace(
      /~\/\.ssh\/voult/g,
      dir,
    );
    expect(generated).toContain('IdentitiesOnly yes');
    const mainConfig = path.join(sshDir, 'main');

    current = keys.p256!;
    const offered: string[] = [];
    const srv = await sshServer(() => current, offered);
    try {
      writeFileSync(mainConfig, generated.replace('Port 22', `Port ${srv.port}`));
      const r = await run(
        ssh,
        [
          '-F',
          mainConfig,
          '-T',
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'UserKnownHostsFile=NUL',
          '-o',
          'BatchMode=yes',
          '-o',
          'IdentityFile=NUL',
          'agenthost',
          'true',
        ],
        { SSH_AUTH_SOCK: pipe },
      );
      expect(r.err).not.toMatch(/Permission denied/);
      expect(r.code).toBe(0);
      // Of the five keys in the agent, ssh offered just the one the host names.
      expect(offered).toHaveLength(1);
      expect(offered[0]).toContain('ecdsa-sha2-nistp256');
    } finally {
      srv.close();
    }
  }, 60_000);
});
