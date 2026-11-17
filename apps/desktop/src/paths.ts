import { homedir, userInfo } from 'node:os';
import path from 'node:path';

export interface Paths {
  /** Voult's private data directory (`%APPDATA%\Voult`). */
  dir: string;
  /** `%USERPROFILE%\.ssh` */
  sshDir: string;
  store: string;
  session: string;
  config: string;
  /** Written by the running agent: pipe name, pid and the token CLI requests must present. */
  runtime: string;
  usageLog: string;
}

export const AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

/** `VOULT_HOME` / `VOULT_SSH_DIR` override the locations (used by tests). */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const dir =
    env.VOULT_HOME ?? path.join(env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'Voult');
  const sshDir = env.VOULT_SSH_DIR ?? path.join(env.USERPROFILE ?? homedir(), '.ssh');
  return {
    dir,
    sshDir,
    store: path.join(dir, 'store.json'),
    session: path.join(dir, 'session.json'),
    config: path.join(dir, 'config.json'),
    runtime: path.join(dir, 'agent.json'),
    usageLog: path.join(dir, 'agent-usage.log'),
  };
}

/** Name of the control pipe the CLI uses to talk to the running agent. */
export function cliPipeName(user: string = userInfo().username): string {
  return `\\\\.\\pipe\\voult-cli-${user.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
