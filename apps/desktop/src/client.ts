import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { callIpc, IpcError } from './ipc';
import type { Paths } from './paths';

interface RuntimeFile {
  pipe: string;
  token: string;
  pid: number;
}

export function readRuntimeFile(paths: Paths): RuntimeFile | null {
  if (!existsSync(paths.runtime)) return null;
  try {
    return JSON.parse(readFileSync(paths.runtime, 'utf8')) as RuntimeFile;
  } catch {
    return null;
  }
}

export const NOT_RUNNING =
  'The Voult agent is not running. Start it with `voult agent` (or `voult agent install` to run it at logon).';

/** How to launch this program again: the single exe when packaged, node + script in development. */
export function selfCommand(extra: string[]): { command: string; args: string[] } {
  const sea = process.getBuiltinModule?.('node:sea') as { isSea?: () => boolean } | undefined;
  if (sea?.isSea?.()) return { command: process.execPath, args: extra };
  return { command: process.execPath, args: [...process.execArgv, process.argv[1]!, ...extra] };
}

/** Send a command to the running agent, starting one in the background if needed. */
export async function send<T = unknown>(
  paths: Paths,
  cmd: string,
  args: Record<string, unknown> = {},
  opts: { start?: boolean } = {},
): Promise<T> {
  let info = readRuntimeFile(paths);
  const attempt = async (i: RuntimeFile) => callIpc<T>(i.pipe, { token: i.token, cmd, args });
  if (info) {
    try {
      return await attempt(info);
    } catch (e) {
      if (e instanceof IpcError) throw e;
      /* stale runtime file: the agent is gone */
    }
  }
  if (opts.start === false) throw new Error(NOT_RUNNING);

  const { command, args: argv } = selfCommand(['agent', 'run']);
  spawn(command, argv, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    info = readRuntimeFile(paths);
    if (!info) continue;
    try {
      return await attempt(info);
    } catch (e) {
      if (e instanceof IpcError) throw e;
    }
  }
  throw new Error('Could not start the Voult agent. Run `voult agent` in a terminal to see why.');
}
