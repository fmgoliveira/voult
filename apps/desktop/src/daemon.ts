import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type net from 'node:net';
import path from 'node:path';
import { createHandlers } from './handlers';
import { newToken, serveIpc } from './ipc';
import { cliPipeName, type Paths } from './paths';
import type { Dpapi } from './dpapi';
import { createRuntime, type Runtime } from './runtime';
import { watchSession } from './session-watcher';

export interface Daemon {
  runtime: Runtime;
  token: string;
  pipe: string;
  stop(): Promise<void>;
}

export interface DaemonOptions {
  paths: Paths;
  dpapi: Dpapi;
  /** Control pipe name; defaults to the per-user pipe. */
  pipe?: string;
  fetch?: typeof fetch;
  /** Poll the server this often while unlocked. 0 disables. */
  syncEveryMs?: number;
  /** Watch Windows session lock/sleep (needs PowerShell). */
  watchSession?: boolean;
  /** Hook for features that need the runtime (SSH agent, ssh config). */
  extend?: (runtime: Runtime) => {
    handlers?: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
    afterSync?: Parameters<typeof createRuntime>[0]['afterSync'];
    stop?: () => Promise<void> | void;
  };
}

/** The long-running process: owns the unlocked vault, the control pipe and (later) the SSH agent. */
export async function startDaemon(opts: DaemonOptions): Promise<Daemon> {
  const { paths } = opts;
  const pipe = opts.pipe ?? cliPipeName();
  const token = newToken();

  const hooks: { current?: ReturnType<NonNullable<DaemonOptions['extend']>> } = {};
  const runtime = createRuntime({
    paths,
    dpapi: opts.dpapi,
    fetch: opts.fetch,
    afterSync: (items) => hooks.current?.afterSync?.(items),
  });
  const extension = (hooks.current = opts.extend?.(runtime));

  const handler = createHandlers({ runtime, paths, extra: extension?.handlers });
  const server: net.Server = await serveIpc(pipe, token, handler);

  // The token lives in a file only this Windows user can read (it sits in their profile).
  mkdirSync(path.dirname(paths.runtime), { recursive: true });
  writeFileSync(paths.runtime, JSON.stringify({ pipe, token, pid: process.pid }), { mode: 0o600 });

  const timers: ReturnType<typeof setInterval>[] = [];
  timers.push(setInterval(() => runtime.checkIdle(), 15_000));
  if (opts.syncEveryMs) {
    timers.push(
      setInterval(() => {
        if (runtime.isUnlocked()) void runtime.sync().catch(() => undefined);
      }, opts.syncEveryMs),
    );
  }
  for (const t of timers) t.unref();

  const stopWatcher = opts.watchSession
    ? watchSession(() => {
        if (runtime.config.lockOnSessionLock) runtime.lock();
      })
    : () => undefined;

  return {
    runtime,
    token,
    pipe,
    async stop() {
      for (const t of timers) clearInterval(t);
      stopWatcher();
      runtime.lock();
      await extension?.stop?.();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(paths.runtime, { force: true });
      (runtime.store as { flush?: () => void }).flush?.();
    },
  };
}
