import { randomBytes } from 'node:crypto';
import type net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, formatStatus, runCli, type CliDeps } from '../src/cli';
import { DEFAULT_CONFIG, loadConfig, saveConfig, setConfigValue } from '../src/config';
import { startDaemon, type Daemon } from '../src/daemon';
import { fakeDpapi, windowsDpapi } from '../src/dpapi';
import { FileStore } from '../src/file-store';
import { callIpc, IpcError, serveIpc } from '../src/ipc';
import { isLockEvent } from '../src/session-watcher';
import {
  EMAIL,
  PASSWORD,
  SERVER_URL,
  generateEd25519,
  seededServer,
  sshKeyItem,
  tempPaths,
  useCheapArgon2,
} from './helpers';
import { setArgon2Implementation } from '@voult/core';

beforeAll(useCheapArgon2);
afterAll(() => setArgon2Implementation(null));

/** A Windows named pipe, or a socket file where the tests run on another OS (CI lint/test). */
const pipeName = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\voult-test-${randomBytes(6).toString('hex')}`
    : path.join(tmpdir(), `voult-test-${randomBytes(6).toString('hex')}.sock`);

describe('ipc', () => {
  it('answers authenticated requests and rejects a wrong token', async () => {
    const pipe = pipeName();
    const server = await serveIpc(pipe, 'secret', async (cmd, args) => {
      if (cmd === 'boom') throw new IpcError('nope', 'code_x');
      return { cmd, args };
    });
    try {
      await expect(callIpc(pipe, { token: 'secret', cmd: 'hi', args: { a: 1 } })).resolves.toEqual({
        cmd: 'hi',
        args: { a: 1 },
      });
      await expect(callIpc(pipe, { token: 'wrong', cmd: 'hi' })).rejects.toMatchObject({
        code: 'unauthorised',
      });
      await expect(callIpc(pipe, { token: 'secret', cmd: 'boom' })).rejects.toMatchObject({
        message: 'nope',
        code: 'code_x',
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('refuses garbage and oversized lines', async () => {
    const pipe = pipeName();
    const server = await serveIpc(pipe, 't', async () => 1);
    const net = await import('node:net');
    const talk = (payload: string) =>
      new Promise<string>((resolve) => {
        const s = net.connect(pipe, () => s.write(payload));
        let out = '';
        s.on('data', (d) => (out += d));
        s.on('end', () => resolve(out));
        s.on('error', () => resolve(out));
      });
    try {
      expect(JSON.parse(await talk('not json\n'))).toMatchObject({
        ok: false,
        error: 'bad request',
      });
      expect(JSON.parse(await talk('x'.repeat(1_100_000)))).toMatchObject({ ok: false });
    } finally {
      await new Promise((r) => (server as net.Server).close(r));
    }
  });
});

describe('daemon + cli end to end (over a real named pipe)', () => {
  it('login, status, lock, unlock, sync, config and logout', async () => {
    const { server } = await seededServer([sshKeyItem(generateEd25519('k'))]);
    const paths = tempPaths();
    const pipe = pipeName();
    const daemon: Daemon = await startDaemon({
      paths,
      dpapi: fakeDpapi,
      pipe,
      fetch: ((i: string | URL | Request, n?: RequestInit) => server.fetch(i, n)) as typeof fetch,
    });
    const out: string[] = [];
    const errs: string[] = [];
    const rt = JSON.parse(readFileSync(paths.runtime, 'utf8')) as { token: string };
    let password = PASSWORD;
    const deps: CliDeps = {
      paths,
      send: (cmd, args = {}) => callIpc(pipe, { token: rt.token, cmd, args }) as never,
      out: (l) => out.push(l),
      err: (l) => errs.push(l),
      promptPassword: async () => password,
      readStdinLine: async () => password,
      runAgent: async () => undefined,
    };
    const run = (...argv: string[]) => runCli(argv, deps, buildProgram(deps));
    try {
      expect(await run('status')).toBe(0);
      expect(out.at(-1)).toMatch(/Not signed in/);

      expect(await run('login', SERVER_URL, EMAIL)).toBe(0);
      expect(out.at(-1)).toMatch(/Signed in\. Synced/);
      expect(daemon.runtime.keyring.size).toBe(1);

      await run('status');
      expect(out.join('\n')).toMatch(/Signed in as me@example\.com/);
      expect(out.join('\n')).toMatch(/Vault: unlocked/);
      expect(out.join('\n')).toMatch(/SSH agent keys: 1/);

      expect(await run('lock')).toBe(0);
      expect(daemon.runtime.keyring.size).toBe(0);
      expect(await run('sync')).toBe(1);
      expect(errs.at(-1)).toMatch(/locked/i);

      password = 'wrong password';
      expect(await run('unlock')).toBe(1);
      expect(errs.at(-1)).toBe('Wrong master password.');
      password = PASSWORD;
      expect(await run('unlock', '--password-stdin')).toBe(0);
      expect(daemon.runtime.keyring.size).toBe(1);
      expect(await run('sync')).toBe(0);
      expect(out.at(-1)).toMatch(/Synced/);

      expect(await run('config', 'idleLockMinutes', '5')).toBe(0);
      expect(daemon.runtime.config.idleLockMinutes).toBe(5);
      expect(loadConfig(paths.config).idleLockMinutes).toBe(5);
      expect(await run('config', 'nope', '1')).toBe(1);
      expect(errs.at(-1)).toMatch(/Unknown setting/);

      expect(await run('logout')).toBe(0);
      expect(existsSync(paths.session)).toBe(false);
      await run('status');
      expect(out.at(-1)).toMatch(/Not signed in/);
    } finally {
      await daemon.stop();
    }
    expect(existsSync(paths.runtime)).toBe(false);
  });

  it('a stale or wrong token cannot drive the agent', async () => {
    const { server } = await seededServer();
    const pipe = pipeName();
    const daemon = await startDaemon({
      paths: tempPaths(),
      dpapi: fakeDpapi,
      pipe,
      fetch: ((i: string | URL | Request, n?: RequestInit) => server.fetch(i, n)) as typeof fetch,
    });
    try {
      await expect(callIpc(pipe, { token: 'guess', cmd: 'status' })).rejects.toMatchObject({
        code: 'unauthorised',
      });
      await expect(callIpc(pipe, { token: daemon.token, cmd: 'nonsense' })).rejects.toMatchObject({
        code: 'bad_command',
      });
    } finally {
      await daemon.stop();
    }
  });
});

describe('cli output', () => {
  it('formats status for each state', () => {
    expect(formatStatus({ signedIn: false } as never)[0]).toMatch(/Not signed in/);
    const base = {
      signedIn: true,
      email: 'a@b.c',
      serverUrl: 'https://v',
      unlocked: false,
      agentKeys: 0,
      lastSyncAt: null,
      lastSyncError: null,
      idleLockMinutes: 0,
    };
    expect(formatStatus(base).join('\n')).toMatch(/locked \(run `voult unlock`\)[\s\S]*never/);
    const now = Date.now();
    const text = formatStatus({
      ...base,
      unlocked: true,
      agentKeys: 2,
      lastSyncAt: now - 90_000,
      lastSyncError: 'offline',
      idleLockMinutes: 15,
    }).join('\n');
    expect(text).toMatch(/unlocked/);
    expect(text).toMatch(/2 min ago \(error: offline\)/);
    expect(text).toMatch(/15 min idle/);
  });

  it('reports unknown commands with exit code 2', async () => {
    const deps = { out: () => undefined, err: () => undefined } as unknown as CliDeps;
    expect(await runCli(['frobnicate'], deps, buildProgram(deps))).toBe(2);
    expect(await runCli(['--help'], deps, buildProgram(deps))).toBe(0);
  });
});

describe('config', () => {
  it('validates and persists settings', () => {
    const { config } = tempPaths();
    expect(loadConfig(config)).toEqual(DEFAULT_CONFIG);
    let c = setConfigValue(DEFAULT_CONFIG, 'idleLockMinutes', '0');
    c = setConfigValue(c, 'lockOnSessionLock', 'off');
    c = setConfigValue(c, 'sshConfigOnSync', 'yes');
    expect(c).toMatchObject({
      idleLockMinutes: 0,
      lockOnSessionLock: false,
      sshConfigOnSync: true,
    });
    saveConfig(config, c);
    expect(loadConfig(config)).toEqual(c);
    expect(() => setConfigValue(c, 'idleLockMinutes', '-1')).toThrow(/number/);
    expect(() => setConfigValue(c, 'lockOnSessionLock', 'maybe')).toThrow(/on or off/);
  });
  it('falls back to defaults for a damaged file', async () => {
    const { writeFileSync } = await import('node:fs');
    const { config } = tempPaths();
    writeFileSync(config, '{ nope');
    expect(loadConfig(config)).toEqual(DEFAULT_CONFIG);
    writeFileSync(config, JSON.stringify({ idleLockMinutes: 'x', sshConfigOnSync: 3 }));
    expect(loadConfig(config)).toEqual(DEFAULT_CONFIG);
  });
});

describe('FileStore', () => {
  it('persists to disk and reloads', async () => {
    const { store } = tempPaths();
    const a = new FileStore(store);
    await a.setMeta('k', { v: 1 });
    await a.addOutbox({ kind: 'item', id: 'i', baseRev: 0 });
    a.flush();
    const b = new FileStore(store);
    expect(await b.getMeta('k')).toEqual({ v: 1 });
    expect(await b.listOutbox()).toHaveLength(1);
    await b.clearAll();
    b.flush();
    expect(await new FileStore(store).getMeta('k')).toBeUndefined();
  });
  it('ignores a corrupt file', async () => {
    const { writeFileSync } = await import('node:fs');
    const { store } = tempPaths();
    writeFileSync(store, 'garbage');
    expect(await new FileStore(store).listItems()).toEqual([]);
  });
});

describe('session watcher', () => {
  it('treats lock, disconnect, logoff and sleep as reasons to lock', () => {
    for (const l of ['session:SessionLock', 'session:ConsoleDisconnect', 'power:Suspend\r']) {
      expect(isLockEvent(l)).toBe(true);
    }
    for (const l of ['ready', 'session:SessionUnlock', 'power:Resume']) {
      expect(isLockEvent(l)).toBe(false);
    }
  });
});

describe.skipIf(process.platform !== 'win32')('Windows DPAPI', () => {
  it('round-trips and is not plaintext', async () => {
    const data = new TextEncoder().encode('refresh-token-123');
    const sealed = await windowsDpapi.protect(data);
    expect(Buffer.from(sealed).toString('latin1')).not.toContain('refresh-token-123');
    expect(Buffer.from(await windowsDpapi.unprotect(sealed)).toString()).toBe('refresh-token-123');
  }, 30_000);
  it('rejects data that was not protected by this user', async () => {
    await expect(windowsDpapi.unprotect(new Uint8Array([1, 2, 3]))).rejects.toThrow(/DPAPI/);
  }, 30_000);
});
