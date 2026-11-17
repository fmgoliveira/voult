import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { parseSshVersion, resolveSsh, supportsAskpassForce } from '../agent/doctor';
import { selfCommand } from '../client';
import type { Paths } from '../paths';
import { classifyPrompt } from './askpass';

export const OLD_SSH_HELP = [
  'Password hosts need OpenSSH 8.4 or newer (the ssh that ships with Windows 10 is 8.1).',
  'Install the current Win32-OpenSSH, either:',
  '  winget install Microsoft.OpenSSH.Preview',
  '  or download it from https://github.com/PowerShell/Win32-OpenSSH/releases',
  'Then open a new terminal and run this again.',
];

export const HOST_KEY_HELP =
  'Voult does not answer host-key questions. Run `ssh <alias>` once in a normal terminal to check and accept the host key, then try again.';

export interface HostInfo {
  alias: string;
  hostname: string;
  username: string;
  auth: 'key' | 'password' | 'keyAndPassword';
  hasPassword: boolean;
}

export interface WrapperDeps {
  paths: Paths;
  send: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  out: (line: string) => void;
  err: (line: string) => void;
  /** ssh program to run, and its `-V` banner. */
  ssh: () => Promise<{ file: string; version: string | null }>;
  /** Run ssh with this environment; resolves with its exit code and captured stderr. */
  runSsh: (
    file: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<{ code: number; stderr: string }>;
  /** The program ssh should call for passwords (this exe, or a shim in development). */
  askpassProgram: () => string;
}

/** `voult ssh <alias> [args…]`: sign in to a password host without typing the password. */
export async function runSshWrapper(
  deps: WrapperDeps,
  alias: string,
  extraArgs: string[],
): Promise<number> {
  const { file, version } = await deps.ssh();
  if (!supportsAskpassForce(parseSshVersion(version ?? ''))) {
    for (const l of OLD_SSH_HELP) deps.err(l);
    return 1;
  }
  const host = await deps.send<HostInfo>('sshHost', { alias });
  const usesPassword = host.auth !== 'key' && host.hasPassword;
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (usesPassword) {
    const { token } = await deps.send<{ token: string }>('askpassIssue', {
      alias,
      user: userInfo().username,
    });
    env.SSH_ASKPASS = deps.askpassProgram();
    env.SSH_ASKPASS_REQUIRE = 'force';
    env.VOULT_ASKPASS_TOKEN = token;
  }
  const r = await deps.runSsh(file, [alias, ...extraArgs], env);
  if (r.code === 255 && /host key verification failed/i.test(r.stderr)) {
    deps.err(HOST_KEY_HELP.replace('<alias>', alias));
  }
  return r.code;
}

// ------------------------------------------------------------------ real implementations

export function realRunSsh(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

export async function realSsh(): Promise<{ file: string; version: string | null }> {
  const file = await resolveSsh();
  const { execFile } = await import('node:child_process');
  const version = await new Promise<string | null>((resolve) =>
    execFile(file, ['-V'], { windowsHide: true }, (_e, out, err) =>
      resolve((String(err) || String(out)).trim() || null),
    ),
  );
  return { file, version };
}

/**
 * What ssh runs for passwords. The packaged exe is its own helper; during development (node +
 * script) a small .cmd shim stands in, since SSH_ASKPASS must be a single executable.
 */
export function askpassProgramFor(paths: Paths): string {
  const sea = process.getBuiltinModule?.('node:sea') as { isSea?: () => boolean } | undefined;
  if (sea?.isSea?.()) return process.execPath;
  const { command, args } = selfCommand([]);
  const shim = path.join(paths.dir, 'askpass.cmd');
  mkdirSync(paths.dir, { recursive: true });
  const line = `@"${command}" ${args.map((a) => `"${a}"`).join(' ')} %*\r\n`;
  writeFileSync(shim, line);
  return shim;
}

// ------------------------------------------------------------------ the helper side

export interface AskpassDeps {
  send: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  write: (text: string) => void;
}

/**
 * Run as `SSH_ASKPASS`: ssh passes the prompt as the only argument and reads the answer from
 * stdout. Returns the exit code (0 = answered, 1 = refused).
 */
export async function runAskpass(
  deps: AskpassDeps,
  token: string,
  prompt: string,
  user: string = userInfo().username,
): Promise<number> {
  if (classifyPrompt(prompt).kind !== 'password') return 1; // host keys, passphrases, codes…
  try {
    const { password } = await deps.send<{ password: string }>('askpassRedeem', {
      token,
      user,
      prompt,
    });
    deps.write(password + '\n');
    return 0;
  } catch {
    return 1;
  }
}
