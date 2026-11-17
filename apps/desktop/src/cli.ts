import { Command } from 'commander';
import { diagnose, realProbes, type Check } from './agent/doctor';
import { installTask, uninstallTask } from './agent/install';
import { selfCommand, send as realSend } from './client';
import type { Config } from './config';
import { IpcError } from './ipc';
import { AGENT_PIPE, type Paths } from './paths';
import { promptHidden, readLineFromStdin } from './prompt';
import type { Status } from './runtime';

export interface CliDeps {
  paths: Paths;
  /** Talk to the running agent. */
  send: <T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
    opts?: { start?: boolean },
  ) => Promise<T>;
  out: (line: string) => void;
  err: (line: string) => void;
  promptPassword: (question: string) => Promise<string>;
  readStdinLine: () => Promise<string>;
  /** Run the agent in this process until it is stopped. */
  runAgent: () => Promise<void>;
  installAgent: () => Promise<void>;
  uninstallAgent: () => Promise<void>;
  doctor: () => Promise<Check[]>;
}

export function defaultDeps(paths: Paths): CliDeps {
  return {
    paths,
    send: (cmd, args, opts) => realSend(paths, cmd, args, opts),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    promptPassword: promptHidden,
    readStdinLine: readLineFromStdin,
    runAgent: async () => (await import('./run-agent')).runAgent(paths),
    async installAgent() {
      const { command, args } = selfCommand(['agent', 'run']);
      await installTask(command, args);
    },
    uninstallAgent: async () => void (await uninstallTask()),
    doctor: () =>
      diagnose(
        realProbes(AGENT_PIPE, async () => {
          try {
            await realSend(paths, 'status', {}, { start: false });
            return true;
          } catch {
            return false;
          }
        }),
      ),
  };
}

const ago = (t: number | null): string => {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)} min ago`
      : `${Math.round(s / 3600)} h ago`;
};

export function formatStatus(s: Status): string[] {
  if (!s.signedIn) return ['Not signed in. Run `voult login <server> <email>`.'];
  return [
    `Signed in as ${s.email} on ${s.serverUrl}`,
    s.unlocked ? 'Vault: unlocked' : 'Vault: locked (run `voult unlock`)',
    `SSH agent keys: ${s.agentKeys}`,
    `Last sync: ${ago(s.lastSyncAt)}${s.lastSyncError ? ` (error: ${s.lastSyncError})` : ''}`,
    `Auto-lock after ${s.idleLockMinutes > 0 ? `${s.idleLockMinutes} min idle` : 'never (idle lock off)'}`,
  ];
}

/** The command-line interface. Everything except `agent` is a thin client of the running agent. */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command('voult')
    .description('Voult desktop companion: SSH agent, ssh config and password-host login')
    .exitOverride()
    .configureOutput({
      writeOut: (s) => deps.out(s.trimEnd()),
      writeErr: (s) => deps.err(s.trimEnd()),
    });

  const password = async (opts: { passwordStdin?: boolean }, question: string) =>
    opts.passwordStdin ? deps.readStdinLine() : deps.promptPassword(question);

  program
    .command('login <server> <email>')
    .description('Sign in to your Voult server and unlock')
    .option('--password-stdin', 'read the master password from stdin')
    .action(async (server: string, email: string, opts: { passwordStdin?: boolean }) => {
      const pw = await password(opts, 'Master password: ');
      const r = await deps.send<{ pulled: number; error?: string }>('login', {
        serverUrl: server,
        email,
        password: pw,
      });
      deps.out(
        `Signed in. ${r.error ? `Sync problem: ${r.error}` : `Synced (${r.pulled} changes).`}`,
      );
    });

  program
    .command('unlock')
    .description('Unlock the vault so the SSH agent can serve keys')
    .option('--password-stdin', 'read the master password from stdin')
    .action(async (opts: { passwordStdin?: boolean }) => {
      const pw = await password(opts, 'Master password: ');
      await deps.send('unlock', { password: pw });
      deps.out('Unlocked.');
    });

  program
    .command('lock')
    .description('Lock the vault and wipe keys from memory')
    .action(async () => {
      await deps.send('lock', {}, { start: false });
      deps.out('Locked.');
    });

  program
    .command('status')
    .description('Show sign-in, lock and sync state')
    .action(async () => {
      try {
        for (const l of formatStatus(await deps.send<Status>('status', {}, { start: false }))) {
          deps.out(l);
        }
      } catch (e) {
        if (e instanceof IpcError) throw e;
        deps.out('The Voult agent is not running.');
        process.exitCode = 1;
      }
    });

  program
    .command('sync')
    .description('Sync with the server now')
    .action(async () => {
      const r = await deps.send<{ pushed: number; pulled: number; error?: string }>('sync');
      deps.out(
        r.error ? `Sync problem: ${r.error}` : `Synced: ${r.pushed} sent, ${r.pulled} received.`,
      );
    });

  program
    .command('logout')
    .description('Sign this computer out and delete its local copy')
    .action(async () => {
      await deps.send('logout', {}, { start: false });
      deps.out('Signed out.');
    });

  const agent = program
    .command('agent')
    .description('The background process that holds the unlocked vault');
  agent
    .command('run', { isDefault: true })
    .description('Run the agent in this window (what `voult agent install` starts at logon)')
    .action(() => deps.runAgent());

  agent
    .command('install')
    .description('Start the agent automatically when you log in to Windows')
    .action(async () => {
      await deps.installAgent();
      deps.out(
        'Installed. The agent will start (hidden) at your next logon; run `voult agent` to start it now.',
      );
    });
  agent
    .command('uninstall')
    .description('Remove the logon task')
    .action(async () => {
      await deps.uninstallAgent();
      deps.out('Removed the logon task.');
    });
  agent
    .command('doctor')
    .description('Check everything the SSH agent needs and say how to fix what is wrong')
    .action(async () => {
      let bad = 0;
      for (const c of await deps.doctor()) {
        deps.out(`${c.ok ? (c.warn ? '!' : '✓') : '✗'} ${c.name}: ${c.message}`);
        if (c.fix) deps.out(`    fix: ${c.fix}`);
        if (!c.ok) bad++;
      }
      if (bad) process.exitCode = 1;
    });

  program
    .command('config [key] [value]')
    .description('Show or change settings (idleLockMinutes, lockOnSessionLock, sshConfigOnSync…)')
    .action(async (key?: string, value?: string) => {
      const c = await deps.send<Config>('config', key && value !== undefined ? { key, value } : {});
      for (const [k, v] of Object.entries(c)) deps.out(`${k} = ${String(v)}`);
    });

  return program;
}

/** Run the CLI; returns the process exit code. */
export async function runCli(
  argv: string[],
  deps: CliDeps,
  program = buildProgram(deps),
): Promise<number> {
  try {
    await program.parseAsync(argv, { from: 'user' });
    return Number(process.exitCode ?? 0);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'commander.helpDisplayed' || code === 'commander.version') return 0;
    if (typeof code === 'string' && code.startsWith('commander.')) return 2;
    deps.err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
