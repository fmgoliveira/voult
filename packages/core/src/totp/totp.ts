import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import type { Totp } from '../vault/schemas';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const HASHES = { SHA1: sha1, SHA256: sha256, SHA512: sha512 } as const;
export type Algorithm = keyof typeof HASHES;

/** RFC 4226 HOTP. `secret` is raw bytes. */
export function hotp(
  secret: Uint8Array,
  counter: number | bigint,
  digits = 6,
  algorithm: Algorithm = 'SHA1',
): string {
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const h = hmac(HASHES[algorithm], secret, msg);
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** RFC 6238 TOTP. `timeMs` is wall-clock milliseconds. */
export function totp(
  secret: Uint8Array,
  timeMs: number,
  period = 30,
  digits = 6,
  algorithm: Algorithm = 'SHA1',
): string {
  return hotp(secret, Math.floor(timeMs / 1000 / period), digits, algorithm);
}

export interface TotpState {
  code: string;
  /** Seconds until `code` expires. */
  remaining: number;
  /** Fraction of the period elapsed, 0–1 (for the countdown ring). */
  progress: number;
}

/** Current code for a stored entry; for HOTP entries `counter` is used and `remaining` is 0. */
export function currentCode(entry: Totp, timeMs: number): TotpState {
  const secret = base32Decode(entry.secret);
  if (entry.kind === 'hotp') {
    return {
      code: hotp(secret, entry.counter, entry.digits, entry.algorithm),
      remaining: 0,
      progress: 0,
    };
  }
  const elapsed = (timeMs / 1000) % entry.period;
  return {
    code: totp(secret, timeMs, entry.period, entry.digits, entry.algorithm),
    remaining: Math.ceil(entry.period - elapsed),
    progress: elapsed / entry.period,
  };
}

/** The code that follows the current one (next-code preview). */
export function nextCode(entry: Totp, timeMs: number): string {
  if (entry.kind === 'hotp') {
    return hotp(base32Decode(entry.secret), entry.counter + 1, entry.digits, entry.algorithm);
  }
  return totp(
    base32Decode(entry.secret),
    timeMs + entry.period * 1000,
    entry.period,
    entry.digits,
    entry.algorithm,
  );
}
