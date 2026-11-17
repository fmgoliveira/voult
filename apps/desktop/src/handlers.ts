import { ApiError, SignedOutError, VaultLockedError, WrongPasswordError } from '@voult/core';
import { saveConfig, setConfigValue } from './config';
import { IpcError } from './ipc';
import type { Paths } from './paths';
import type { Runtime } from './runtime';

export interface HandlerContext {
  runtime: Runtime;
  paths: Paths;
  /** Extra commands added by other features (ssh config, askpass…). */
  extra?: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new IpcError(`missing ${name}`, 'bad_args');
  return v;
};

/** Turn the library's errors into messages a person can act on. */
export function friendlyError(e: unknown): IpcError {
  if (e instanceof IpcError) return e;
  if (e instanceof WrongPasswordError)
    return new IpcError('Wrong master password.', 'wrong_password');
  if (e instanceof VaultLockedError) {
    return new IpcError('Voult is locked. Run `voult unlock`.', 'locked');
  }
  if (e instanceof SignedOutError) {
    return new IpcError('Signed out. Run `voult login <server> <email>`.', 'signed_out');
  }
  if (e instanceof ApiError) {
    return new IpcError(
      e.status === 401 || e.status === 403
        ? 'The server rejected the email or password.'
        : `Server error: ${e.code}`,
      e.code,
    );
  }
  return new IpcError(e instanceof Error ? e.message : String(e));
}

/** The commands the CLI can send to the running agent. */
export function createHandlers(ctx: HandlerContext) {
  const { runtime: rt } = ctx;
  const table: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    async status() {
      return rt.status();
    },
    async login(a) {
      return rt.login({
        serverUrl: str(a.serverUrl, 'server'),
        email: str(a.email, 'email'),
        password: str(a.password, 'password'),
      });
    },
    async unlock(a) {
      return rt.unlock(str(a.password, 'password'));
    },
    async lock() {
      rt.lock();
      return rt.status();
    },
    async logout() {
      await rt.logout();
    },
    async sync() {
      if (!rt.isUnlocked()) throw new IpcError('Voult is locked. Run `voult unlock`.', 'locked');
      return rt.sync();
    },
    async config(a) {
      if (typeof a.key === 'string' && typeof a.value === 'string') {
        const next = setConfigValue(rt.config, a.key, a.value);
        saveConfig(ctx.paths.config, next);
        rt.setConfig(next);
      }
      return rt.config;
    },
    ...ctx.extra,
  };
  return async (cmd: string, args: Record<string, unknown>): Promise<unknown> => {
    const fn = table[cmd];
    if (!fn) throw new IpcError(`unknown command ${cmd}`, 'bad_command');
    // Real use of the vault keeps it unlocked; background polling does not count.
    if (cmd !== 'status') rt.touch();
    try {
      return await fn(args);
    } catch (e) {
      throw friendlyError(e);
    }
  };
}
