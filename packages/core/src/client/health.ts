import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { utf8 } from '../crypto/bytes';
import type { LoginItem } from '../vault/schemas';
import type { ItemView } from './types';

// ---------------------------------------------------------------- strength

/** A few hundred real-world passwords would be better; these catch the usual suspects. */
const COMMON = new Set(
  (
    'password,password1,password123,passw0rd,123456,1234567,12345678,123456789,1234567890,111111,' +
    '000000,123123,654321,qwerty,qwerty123,qwertyuiop,azerty,abc123,abcd1234,iloveyou,admin,admin123,' +
    'letmein,welcome,welcome1,monkey,dragon,master,login,princess,sunshine,football,baseball,shadow,' +
    'superman,batman,trustno1,starwars,hello,freedom,whatever,qazwsx,zaq12wsx,1q2w3e4r,1qaz2wsx,' +
    'changeme,secret,default,test,test123,guest,root,toor,pass,pass123,p@ssw0rd,p@ssword,passw0rd1'
  ).split(','),
);

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiopasdfghjklzxcvbnm'];

function hasSequence(p: string): boolean {
  const s = p.toLowerCase();
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 4 <= seq.length; i++) {
      const part = seq.slice(i, i + 4);
      if (s.includes(part) || s.includes([...part].reverse().join(''))) return true;
    }
  }
  return false;
}

export interface Strength {
  /** 0 (terrible) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  bits: number;
}

/**
 * A fast, dependency-free estimate: character-pool entropy of the distinct characters, reduced for
 * repetition, keyboard/alphabet runs and well-known passwords. It is deliberately conservative.
 */
export function passwordStrength(password: string): Strength {
  if (!password) return { score: 0, bits: 0 };
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[0-9!@#$%^&*]+$/, ''))) {
    return { score: 0, bits: 8 };
  }
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^A-Za-z0-9]/.test(password)) pool += 33;
  const distinct = new Set(password).size;
  let bits = Math.min(password.length, distinct * 2) * Math.log2(Math.max(pool, 2));
  if (hasSequence(password)) bits -= 12;
  if (/(.)\1{2,}/.test(password)) bits -= 8;
  if (/^[A-Za-z]+[0-9]{1,4}[!@#$%^&*]?$/.test(password)) bits -= 10; // Word + digits
  bits = Math.max(0, Math.round(bits));
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, bits };
}

// ---------------------------------------------------------------- report

export const OLD_PASSWORD_MS = 365 * 24 * 60 * 60 * 1000;

export interface HealthReport {
  total: number;
  weak: ItemView[];
  /** Logins sharing the exact same password, grouped. */
  reused: ItemView[][];
  /** Password unchanged for over a year. */
  old: ItemView[];
  /** Logins with a password but no 2FA (informational). */
  score: number;
}

const live = (items: ItemView[]) =>
  items.filter(
    (v): v is ItemView & { item: LoginItem } =>
      !v.deletedAt && v.item.type === 'login' && !!v.item.password,
  );

/** When the current password was set: the newest history entry, else the item's creation. */
export function passwordAge(item: LoginItem): number {
  const last = item.passwordHistory.at(-1)?.changedAt;
  return last ?? item.createdAt;
}

export function analyzeHealth(items: ItemView[], now = Date.now()): HealthReport {
  const logins = live(items);
  const weak = logins.filter((v) => passwordStrength(v.item.password).score <= 1);
  const byPassword = new Map<string, ItemView[]>();
  for (const v of logins) {
    const list = byPassword.get(v.item.password) ?? [];
    list.push(v);
    byPassword.set(v.item.password, list);
  }
  const reused = [...byPassword.values()].filter((g) => g.length > 1);
  const old = logins.filter((v) => now - passwordAge(v.item) > OLD_PASSWORD_MS);
  const bad = new Set([...weak, ...reused.flat(), ...old].map((v) => v.id));
  const score = logins.length ? Math.round(100 * (1 - bad.size / logins.length)) : 100;
  return { total: logins.length, weak, reused, old, score };
}

// ---------------------------------------------------------------- breaches (HIBP k-anonymity)

export const sha1Hex = (s: string): string => bytesToHex(sha1(utf8(s))).toUpperCase();

/**
 * Checks passwords against Have I Been Pwned's range API. Only the first 5 characters of each
 * SHA-1 leave the device (k-anonymity) and responses are padded, so neither the password nor its
 * full hash is ever sent. Returns how many times each breached password appears.
 */
export async function checkBreached(
  passwords: string[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, number>> {
  const hashes = new Map<string, string>();
  const prefixes = new Map<string, string[]>();
  for (const p of new Set(passwords)) {
    const h = sha1Hex(p);
    hashes.set(p, h);
    const prefix = h.slice(0, 5);
    prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), h.slice(5)]);
  }
  const counts = new Map<string, number>();
  const queue = [...prefixes.keys()];
  const worker = async () => {
    for (let prefix = queue.shift(); prefix; prefix = queue.shift()) {
      const res = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
      });
      if (!res.ok) throw new Error('breach_check_failed');
      const found = new Map<string, number>();
      for (const line of (await res.text()).split(/\r?\n/)) {
        const [suffix, n] = line.split(':');
        if (suffix && Number(n) > 0) found.set(suffix.trim().toUpperCase(), Number(n));
      }
      for (const [password, h] of hashes) {
        if (h.startsWith(prefix)) {
          const n = found.get(h.slice(5));
          if (n) counts.set(password, n);
        }
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return counts;
}

/** Logins whose password appears in a known breach. */
export async function breachedLogins(
  items: ItemView[],
  fetchFn: typeof fetch = fetch,
): Promise<{ item: ItemView; count: number }[]> {
  const logins = live(items);
  const counts = await checkBreached(
    logins.map((v) => v.item.password),
    fetchFn,
  );
  return logins
    .filter((v) => counts.has(v.item.password))
    .map((v) => ({ item: v, count: counts.get(v.item.password)! }));
}
