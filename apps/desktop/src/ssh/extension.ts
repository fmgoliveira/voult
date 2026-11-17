import type { ItemView, SshHostItem } from '@voult/core';
import type { DaemonOptions } from '../daemon';
import { IpcError } from '../ipc';
import type { Paths } from '../paths';
import type { Runtime } from '../runtime';
import { AskpassTokens, classifyPrompt, promptMatchesHost, TokenError } from './askpass';
import { writeSshConfig, type LockDown } from './config';

export interface SshExtensionOptions {
  paths: Paths;
  lockDown?: LockDown;
  tokens?: AskpassTokens;
}

const hostsOf = (items: ItemView[]) =>
  items.flatMap((v) =>
    v.deletedAt === null && v.item.type === 'sshHost' ? [{ id: v.id, host: v.item }] : [],
  );

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** ssh config generation and the password helper's commands, attached to the daemon. */
export function sshExtension(opts: SshExtensionOptions): NonNullable<DaemonOptions['extend']> {
  return (runtime: Runtime) => {
    const tokens = opts.tokens ?? new AskpassTokens();
    runtime.onLock(() => tokens.clear());
    const write = async (items: ItemView[]) =>
      writeSshConfig(opts.paths.sshDir, items, {
        allowCommandOptions: runtime.config.allowCommandOptions,
        lockDown: opts.lockDown,
      });

    const findHost = async (alias: string): Promise<SshHostItem> => {
      const found = hostsOf(await runtime.loadItems()).find((h) => h.host.alias === alias);
      if (!found) throw new IpcError(`No SSH host with the alias "${alias}".`, 'unknown_host');
      return found.host;
    };
    const requireUnlocked = () => {
      if (!runtime.isUnlocked())
        throw new IpcError('Voult is locked. Run `voult unlock`.', 'locked');
    };

    return {
      async afterSync(items) {
        if (runtime.config.sshConfigOnSync) await write(items).catch(() => undefined);
      },
      stop: () => tokens.clear(),
      handlers: {
        async sshConfig() {
          requireUnlocked();
          const r = await write(await runtime.loadItems());
          return { dir: r.dir, hosts: r.hosts, keys: r.publicKeys.size, warnings: r.warnings };
        },
        async sshList() {
          requireUnlocked();
          return hostsOf(await runtime.loadItems())
            .map(({ host }) => ({
              alias: host.alias,
              hostname: host.hostname,
              username: host.username,
              auth: host.auth,
            }))
            .sort((a, b) => a.alias.localeCompare(b.alias));
        },
        async sshHost(a) {
          requireUnlocked();
          const h = await findHost(str(a.alias));
          return {
            alias: h.alias,
            hostname: h.hostname,
            username: h.username,
            auth: h.auth,
            hasPassword: h.password !== '',
          };
        },
        async askpassIssue(a) {
          requireUnlocked();
          const h = await findHost(str(a.alias));
          if (h.auth === 'key' || !h.password) {
            throw new IpcError(`"${h.alias}" has no password stored.`, 'no_password');
          }
          return { token: tokens.issue(h.alias, str(a.user)) };
        },
        async askpassRedeem(a) {
          requireUnlocked();
          let alias: string;
          try {
            alias = tokens.redeem(str(a.token), str(a.user));
          } catch (e) {
            if (e instanceof TokenError) throw new IpcError(e.message, 'bad_token');
            throw e;
          }
          const h = await findHost(alias);
          if (!promptMatchesHost(classifyPrompt(str(a.prompt)), h)) {
            throw new IpcError('That prompt is not for this host’s password.', 'bad_prompt');
          }
          return { password: h.password };
        },
      },
    };
  };
}
