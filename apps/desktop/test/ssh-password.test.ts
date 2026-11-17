import { setArgon2Implementation } from '@voult/core';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import ssh2 from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentExtension } from '../src/agent';
import { combineExtensions, startDaemon, type Daemon } from '../src/daemon';
import { fakeDpapi } from '../src/dpapi';
import { callIpc } from '../src/ipc';
import {
  AskpassTokens,
  classifyPrompt,
  promptMatchesHost,
  TOKEN_TTL_MS,
  TokenError,
} from '../src/ssh/askpass';
import { sshExtension } from '../src/ssh/extension';
import {
  HOST_KEY_HELP,
  OLD_SSH_HELP,
  realRunSsh,
  realSsh,
  runAskpass,
  runSshWrapper,
  type WrapperDeps,
} from '../src/ssh/wrapper';
import {
  EMAIL,
  generateEd25519,
  PASSWORD,
  seededServer,
  SERVER_URL,
  sshHostItem,
  sshKeyItem,
  tempPaths,
  useCheapArgon2,
} from './helpers';

const { Server } = ssh2;

describe('askpass tokens', () => {
  it('work once, for the right user, within 60 seconds', () => {
    let t = 1000;
    const tokens = new AskpassTokens(() => t);
    const a = tokens.issue('box', 'alice');
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(tokens.issue('box', 'alice')).not.toBe(a);

    expect(tokens.redeem(a, 'alice')).toBe('box');
    expect(() => tokens.redeem(a, 'alice')).toThrow(TokenError); // reuse
    try {
      tokens.redeem(a, 'alice');
    } catch (e) {
      expect((e as TokenError).reason).toBe('used');
    }

    const b = tokens.issue('db', 'alice');
    expect(() => tokens.redeem(b, 'mallory')).toThrow(/wrong_user/);
    expect(tokens.redeem(b, 'alice')).toBe('db'); // a wrong user does not burn it

    const c = tokens.issue('web', 'alice');
    t += TOKEN_TTL_MS - 1;
    expect(tokens.redeem(c, 'alice')).toBe('web');
    const d = tokens.issue('web', 'alice');
    t += TOKEN_TTL_MS;
    expect(() => tokens.redeem(d, 'alice')).toThrow(/expired/);
    expect(() => tokens.redeem('nope', 'alice')).toThrow(/unknown/);
  });

  it('are forgotten on clear', () => {
    const tokens = new AskpassTokens();
    const a = tokens.issue('box', 'alice');
    tokens.clear();
    expect(() => tokens.redeem(a, 'alice')).toThrow(/unknown/);
  });
});

describe('prompt classification', () => {
  it('answers password prompts only', () => {
    expect(classifyPrompt("alice@box.example.com's password: ")).toEqual({
      kind: 'password',
      user: 'alice',
      host: 'box.example.com',
    });
    expect(classifyPrompt('Password:')).toEqual({ kind: 'password' });
    for (const p of [
      'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
      "The authenticity of host 'x' can't be established.",
      'Enter passphrase for key /home/a/.ssh/id: ',
      'Verification code: ',
      'Enter PIN for authenticator: ',
      '',
    ]) {
      expect(classifyPrompt(p).kind).toBe('other');
    }
  });

  it('never gives a host its password to a different host (e.g. a jump host)', () => {
    const host = { hostname: 'target.example.com', username: 'alice' };
    const p = (s: string) => classifyPrompt(s);
    expect(promptMatchesHost(p("alice@target.example.com's password:"), host)).toBe(true);
    expect(promptMatchesHost(p("alice@TARGET.example.com's password:"), host)).toBe(true);
    expect(promptMatchesHost(p('Password:'), host)).toBe(true);
    expect(promptMatchesHost(p("alice@jump.example.com's password:"), host)).toBe(false);
    expect(promptMatchesHost(p("bob@target.example.com's password:"), host)).toBe(false);
    expect(promptMatchesHost(p('Verification code:'), host)).toBe(false);
    expect(
      promptMatchesHost(p("anyone@target.example.com's password:"), { ...host, username: '' }),
    ).toBe(true);
  });
});

describe('askpass helper', () => {
  it('answers a password prompt and refuses everything else', async () => {
    const sent: unknown[] = [];
    let written = '';
    const deps = {
      send: async (cmd: string, args?: Record<string, unknown>) => {
        sent.push([cmd, args]);
        return { password: 's3cret' } as never;
      },
      write: (t: string) => (written += t),
    };
    expect(await runAskpass(deps, 'tok', "me@h's password: ", 'me')).toBe(0);
    expect(written).toBe('s3cret\n');
    expect(sent).toEqual([
      ['askpassRedeem', { token: 'tok', user: 'me', prompt: "me@h's password: " }],
    ]);

    sent.length = 0;
    written = '';
    expect(
      await runAskpass(deps, 'tok', 'Are you sure you want to continue connecting?', 'me'),
    ).toBe(1);
    expect(sent).toEqual([]); // never even asked the agent
    expect(written).toBe('');
  });

  it('fails quietly when the agent says no', async () => {
    const deps = {
      send: async () => {
        throw new Error('bad token');
      },
      write: () => {
        throw new Error('must not print');
      },
    };
    expect(await runAskpass(deps, 't', 'Password:', 'me')).toBe(1);
  });
});

describe('voult ssh wrapper (unit)', () => {
  const base = (over: Partial<WrapperDeps> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const runs: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const sent: [string, Record<string, unknown> | undefined][] = [];
    const deps: WrapperDeps = {
      paths: tempPaths(),
      send: (async (cmd: string, args?: Record<string, unknown>) => {
        sent.push([cmd, args]);
        if (cmd === 'sshHost') {
          return {
            alias: 'box',
            hostname: 'h',
            username: 'u',
            auth: 'password',
            hasPassword: true,
          };
        }
        return { token: 'tok123' };
      }) as WrapperDeps['send'],
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      ssh: async () => ({ file: 'ssh', version: 'OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2' }),
      runSsh: async (file, args, env) => {
        runs.push({ file, args, env });
        return { code: 0, stderr: '' };
      },
      askpassProgram: () => 'C:\\voult.exe',
      ...over,
    };
    return { deps, out, err, runs, sent };
  };

  it('runs ssh with the askpass environment for a password host', async () => {
    const { deps, runs, sent } = base();
    expect(await runSshWrapper(deps, 'box', ['-p', '2222'])).toBe(0);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.args).toEqual(['box', '-p', '2222']);
    expect(runs[0]!.env).toMatchObject({
      SSH_ASKPASS: 'C:\\voult.exe',
      SSH_ASKPASS_REQUIRE: 'force',
      VOULT_ASKPASS_TOKEN: 'tok123',
    });
    expect(sent.map((s) => s[0])).toEqual(['sshHost', 'askpassIssue']);
    // The password itself is never part of what is passed to ssh.
    // (Only the args and the variables the wrapper adds: the inherited environment is the runner's.)
    expect(runs[0]!.args.join(' ')).not.toMatch(/password/i);
  });

  it('does not set up askpass for a key host', async () => {
    const { deps, runs, sent } = base({
      send: (async (cmd: string) =>
        cmd === 'sshHost'
          ? { alias: 'k', hostname: 'h', username: '', auth: 'key', hasPassword: false }
          : { token: 'x' }) as WrapperDeps['send'],
    });
    await runSshWrapper(deps, 'k', []);
    expect(runs[0]!.env.SSH_ASKPASS_REQUIRE).toBeUndefined();
    expect(runs[0]!.env.VOULT_ASKPASS_TOKEN).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('explains how to upgrade when ssh is older than 8.4', async () => {
    for (const version of ['OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2', null, 'nonsense']) {
      const { deps, err, runs } = base({ ssh: async () => ({ file: 'ssh', version }) });
      expect(await runSshWrapper(deps, 'box', [])).toBe(1);
      expect(err).toEqual(OLD_SSH_HELP);
      expect(err.join('\n')).toMatch(/winget install Microsoft\.OpenSSH\.Preview/);
      expect(err.join('\n')).toMatch(/github\.com\/PowerShell\/Win32-OpenSSH/);
      expect(runs).toEqual([]);
    }
  });

  it('points the user at a normal terminal when the host key is not known yet', async () => {
    const { deps, err } = base({
      runSsh: async () => ({ code: 255, stderr: 'Host key verification failed.\r\n' }),
    });
    expect(await runSshWrapper(deps, 'box', [])).toBe(255);
    expect(err).toEqual([HOST_KEY_HELP.replace('<alias>', 'box')]);
  });

  it('passes ssh exit codes through', async () => {
    const { deps } = base({ runSsh: async () => ({ code: 3, stderr: '' }) });
    expect(await runSshWrapper(deps, 'box', [])).toBe(3);
  });
});

// ------------------------------------------------------------------ real ssh against a password sshd

const win = process.platform === 'win32';
const pipeName = (p: string) => `\\\\.\\pipe\\voult-${p}-${randomBytes(6).toString('hex')}`;

function passwordServer(expected: () => string) {
  const attempts: string[] = [];
  const host = generateEd25519('host');
  const server = new Server({ hostKeys: [host.privateKey] }, (client) => {
    client
      .on('authentication', (ctx) => {
        if (ctx.method === 'password') {
          attempts.push(ctx.password);
          if (ctx.username === 'tester' && ctx.password === expected()) return ctx.accept();
        }
        ctx.reject(['password']);
      })
      .on('ready', () =>
        client.on('session', (accept) =>
          accept().on('exec', (ok) => {
            const s = ok();
            s.write('welcome\n');
            s.exit(0);
            s.end();
          }),
        ),
      )
      .on('error', () => undefined);
  });
  return new Promise<{ port: number; attempts: string[]; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        attempts,
        close: () => server.close(),
      }),
    ),
  );
}

describe.skipIf(!win)('voult ssh against a password server (real OpenSSH)', () => {
  let daemon: Daemon;
  let cliPipe: string;
  const paths = tempPaths();
  let shim: string;
  let seeded: Awaited<ReturnType<typeof seededServer>>;

  beforeAll(async () => {
    useCheapArgon2();
    const key = generateEd25519('k');
    seeded = await seededServer([
      sshKeyItem(key, { title: 'k' }),
      sshHostItem({
        alias: 'pwhost',
        hostname: '127.0.0.1',
        username: 'tester',
        auth: 'password',
        password: 'right-pw',
        port: 1,
      }),
    ]);
    const { server } = seeded;
    cliPipe = pipeName('cli');
    daemon = await startDaemon({
      paths,
      dpapi: fakeDpapi,
      pipe: cliPipe,
      fetch: ((i: string | URL | Request, n?: RequestInit) => server.fetch(i, n)) as typeof fetch,
      extend: combineExtensions(
        agentExtension({ paths, pipe: pipeName('agent'), notifyLocked: () => undefined }),
        sshExtension({ paths, lockDown: async () => undefined }),
      ),
    });
    await daemon.runtime.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });

    // The helper ssh calls: this program's own source, run through tsx.
    mkdirSync(paths.dir, { recursive: true });
    shim = path.join(paths.dir, 'askpass-test.cmd');
    const main = path.resolve(__dirname, '../src/main.ts');
    writeFileSync(shim, `@"${process.execPath}" --import tsx "${main}" %*\r\n`);
  }, 60_000);

  afterAll(async () => {
    await daemon?.stop();
    setArgon2Implementation(null);
  });

  const send: WrapperDeps['send'] = (cmd, args) => {
    const info = JSON.parse(readFileSync(paths.runtime, 'utf8')) as { token: string };
    return callIpc(cliPipe, { token: info.token, cmd, args: args ?? {} }) as never;
  };

  /** Point the vault's host at the throwaway server, edit it "from another device", and sync. */
  async function useServer(port: number, password: string) {
    await seeded.other.vault.saveItem(
      seeded.vaultId,
      sshHostItem({
        alias: 'pwhost',
        hostname: '127.0.0.1',
        username: 'tester',
        auth: 'password',
        password,
        port,
      }),
      seeded.ids[1],
    );
    await seeded.other.sync.syncOnce();
    await daemon.runtime.sync();
    await send('sshConfig');
  }

  const wrapperDeps = (extraEnv: Record<string, string> = {}): WrapperDeps => ({
    paths,
    send,
    out: () => undefined,
    err: () => undefined,
    ssh: realSsh,
    runSsh: (file, args, env) =>
      realRunSsh(file, args, { ...env, VOULT_HOME: paths.dir, ...extraEnv }),
    askpassProgram: () => shim,
  });

  const sshArgs = (configFile: string) => [
    '-F',
    configFile,
    '-T',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=NUL',
    '-o',
    'IdentityFile=NUL',
  ];

  it('logs in without typing the password, and the password is never in ssh\u2019s arguments', async () => {
    const srv = await passwordServer(() => 'right-pw');
    try {
      await useServer(srv.port, 'right-pw');
      const mainConfig = path.join(paths.dir, 'ssh-main-config');
      writeFileSync(
        mainConfig,
        `Include ${path.join(paths.sshDir, 'voult', 'config').replace(/\\/g, '/')}\n`,
      );
      const calls: string[][] = [];
      const deps = wrapperDeps();
      const real = deps.runSsh;
      deps.runSsh = (file, args, env) => {
        calls.push(args);
        return real(file, args, env);
      };
      const code = await runSshWrapper(deps, 'pwhost', [...sshArgs(mainConfig), 'true']);
      expect(code).toBe(0);
      expect(srv.attempts).toEqual(['right-pw']);
      expect(JSON.stringify(calls)).not.toContain('right-pw');
    } finally {
      srv.close();
    }
  }, 90_000);

  it('does not retry a wrong stored password (the token is single use)', async () => {
    const srv = await passwordServer(() => 'something-else');
    try {
      await useServer(srv.port, 'wrong-pw');
      const mainConfig = path.join(paths.dir, 'ssh-main-config');
      const code = await runSshWrapper(wrapperDeps(), 'pwhost', [...sshArgs(mainConfig), 'true']);
      expect(code).not.toBe(0);
      // The stored password is tried once; ssh's own retries get nothing from the agent.
      expect(srv.attempts.filter((a) => a === 'wrong-pw')).toHaveLength(1);
    } finally {
      srv.close();
    }
  }, 90_000);

  it('refuses the host-key question instead of answering it', async () => {
    const srv = await passwordServer(() => 'right-pw');
    try {
      await useServer(srv.port, 'right-pw');
      const mainConfig = path.join(paths.dir, 'ssh-main-config');
      const known = path.join(paths.dir, 'empty_known_hosts');
      writeFileSync(known, '');
      const code = await runSshWrapper(wrapperDeps(), 'pwhost', [
        '-F',
        mainConfig,
        '-T',
        '-o',
        'StrictHostKeyChecking=ask',
        '-o',
        `UserKnownHostsFile=${known.replace(/\\/g, '/')}`,
        '-o',
        'IdentityFile=NUL',
        'true',
      ]);
      expect(code).not.toBe(0);
      expect(srv.attempts).toEqual([]); // never got as far as a password
    } finally {
      srv.close();
    }
  }, 90_000);

  it('the agent hands out nothing once locked', async () => {
    daemon.runtime.lock();
    await expect(send('askpassIssue', { alias: 'pwhost', user: 'x' })).rejects.toThrow(/locked/i);
    await daemon.runtime.unlock(PASSWORD);
  }, 60_000);

  it('the config files exist on disk afterwards', () => {
    expect(existsSync(path.join(paths.sshDir, 'voult', 'config'))).toBe(true);
  });
});
