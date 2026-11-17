import { randomBytes } from 'node:crypto';

/** A one-time token lives this long. */
export const TOKEN_TTL_MS = 60_000;

export type RedeemError = 'unknown' | 'used' | 'expired' | 'wrong_user';

export class TokenError extends Error {
  constructor(readonly reason: RedeemError) {
    super(`askpass token rejected: ${reason}`);
  }
}

interface Entry {
  alias: string;
  user: string;
  expires: number;
  used: boolean;
}

/**
 * One-time, short-lived tokens that let the `SSH_ASKPASS` helper ask the agent for one host's
 * password. The password itself is never in argv, env or a file: only this token is.
 */
export class AskpassTokens {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = TOKEN_TTL_MS,
  ) {}

  issue(alias: string, user: string): string {
    this.sweep();
    const token = randomBytes(24).toString('hex');
    this.entries.set(token, { alias, user, expires: this.now() + this.ttlMs, used: false });
    return token;
  }

  /** Spend a token. Throws `TokenError`; a token works exactly once, for the user it was made for. */
  redeem(token: string, user: string): string {
    const e = this.entries.get(token);
    if (!e) throw new TokenError('unknown');
    if (e.used) throw new TokenError('used');
    if (this.now() >= e.expires) {
      this.entries.delete(token);
      throw new TokenError('expired');
    }
    if (e.user !== user) throw new TokenError('wrong_user');
    e.used = true;
    return e.alias;
  }

  /** Tokens forgotten (on lock/logout) can no longer be spent. */
  clear(): void {
    this.entries.clear();
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (e.used || t >= e.expires) this.entries.delete(k);
  }
}

export type PromptKind = { kind: 'password'; user?: string; host?: string } | { kind: 'other' };

/**
 * Only plain password prompts are answered. Host-key confirmations, key passphrases, one-time
 * codes and anything else are refused so they reach the user (or fail), never the vault.
 */
export function classifyPrompt(prompt: string): PromptKind {
  const p = prompt.trim();
  const m = /^(?:(.+)@(.+?)'s )?password:$/i.exec(p);
  if (!m) return { kind: 'other' };
  return m[1] ? { kind: 'password', user: m[1], host: m[2] } : { kind: 'password' };
}

/** Whether a password prompt is for the host the user asked for (not a jump host). */
export function promptMatchesHost(
  prompt: PromptKind,
  host: { hostname: string; username: string },
): boolean {
  if (prompt.kind !== 'password') return false;
  if (!prompt.host) return true; // `Password:` with no target: nothing to compare
  if (prompt.host.toLowerCase() !== host.hostname.toLowerCase()) return false;
  return !host.username || !prompt.user || prompt.user === host.username;
}
