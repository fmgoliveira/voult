import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Config {
  /** Lock after this many idle minutes; 0 turns idle locking off. */
  idleLockMinutes: number;
  /** Lock when Windows locks the session or goes to sleep. */
  lockOnSessionLock: boolean;
  /** Rewrite the ssh config after every sync. */
  sshConfigOnSync: boolean;
  /** Let a host's extra options use ProxyCommand, LocalCommand… (they run programs). */
  allowCommandOptions: boolean;
  /** Seconds a signature confirmation stays open before it counts as a denial. */
  confirmTimeoutSeconds: number;
}

export const DEFAULT_CONFIG: Config = {
  idleLockMinutes: 15,
  lockOnSessionLock: true,
  sshConfigOnSync: true,
  allowCommandOptions: false,
  confirmTimeoutSeconds: 30,
};

export function loadConfig(file: string): Config {
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
    return {
      idleLockMinutes: nonNegative(raw.idleLockMinutes, DEFAULT_CONFIG.idleLockMinutes),
      lockOnSessionLock:
        typeof raw.lockOnSessionLock === 'boolean'
          ? raw.lockOnSessionLock
          : DEFAULT_CONFIG.lockOnSessionLock,
      sshConfigOnSync:
        typeof raw.sshConfigOnSync === 'boolean'
          ? raw.sshConfigOnSync
          : DEFAULT_CONFIG.sshConfigOnSync,
      allowCommandOptions:
        typeof raw.allowCommandOptions === 'boolean'
          ? raw.allowCommandOptions
          : DEFAULT_CONFIG.allowCommandOptions,
      confirmTimeoutSeconds: nonNegative(
        raw.confirmTimeoutSeconds,
        DEFAULT_CONFIG.confirmTimeoutSeconds,
      ),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function nonNegative(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function saveConfig(file: string, config: Config): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2));
}

/** Parse `voult config <key> <value>`; throws a readable message for bad input. */
export function setConfigValue(config: Config, key: string, value: string): Config {
  if (!(key in DEFAULT_CONFIG)) {
    throw new Error(
      `Unknown setting "${key}". Settings: ${Object.keys(DEFAULT_CONFIG).join(', ')}`,
    );
  }
  const k = key as keyof Config;
  if (typeof DEFAULT_CONFIG[k] === 'boolean') {
    if (!/^(true|false|on|off|yes|no)$/i.test(value)) throw new Error(`${key} must be on or off`);
    return { ...config, [k]: /^(true|on|yes)$/i.test(value) };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a number, 0 or more`);
  return { ...config, [k]: n };
}
