import type { DaemonOptions } from '../daemon';
import type { Config } from '../config';
import { AGENT_PIPE, type Paths } from '../paths';
import type { Runtime } from '../runtime';
import { confirmSignature, showToast } from './prompts';
import { fileUsageLog, startAgentServer, type AgentDeps } from './server';

export interface AgentOptions {
  paths: Paths;
  /** Pipe to listen on as the SSH agent (default: the OpenSSH agent pipe). */
  pipe?: string;
  confirm?: AgentDeps['confirm'];
  notifyLocked?: () => void;
}

const LOCKED_TOAST_EVERY_MS = 30_000;

/** Attach the SSH agent to a daemon: serves the runtime's keyring on the agent pipe. */
export function agentExtension(opts: AgentOptions): NonNullable<DaemonOptions['extend']> {
  return (runtime: Runtime) => {
    let server: Awaited<ReturnType<typeof startAgentServer>> | undefined;
    let lastToast = 0;
    const config = (): Config => runtime.config;
    const deps: AgentDeps = {
      keyring: runtime.keyring,
      isUnlocked: () => runtime.isUnlocked(),
      touch: () => runtime.touch(),
      notifyLocked:
        opts.notifyLocked ??
        (() => {
          if (Date.now() - lastToast < LOCKED_TOAST_EVERY_MS) return;
          lastToast = Date.now();
          showToast('Voult is locked — run `voult unlock`');
        }),
      confirm:
        opts.confirm ??
        ((key) => confirmSignature(key.title, key.fingerprint, config().confirmTimeoutSeconds)),
      logUse: fileUsageLog(opts.paths.usageLog),
    };
    const ready = startAgentServer(deps, opts.pipe ?? AGENT_PIPE).then((s) => (server = s));
    return {
      /** Resolves once the pipe is listening (rejects with EADDRINUSE if it is taken). */
      ready,
      async stop() {
        await ready.catch(() => undefined);
        await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      },
    };
  };
}
