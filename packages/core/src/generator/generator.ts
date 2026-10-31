import { randomBytes } from '../crypto/bytes';
import { EFF_WORDLIST } from '../wordlists/eff-large';

/** Uniform integer in [0, max) using rejection sampling (no modulo bias). */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('invalid max');
  const limit = Math.floor(2 ** 32 / max) * max;
  for (;;) {
    const b = randomBytes(4);
    const n = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    if (n < limit) return n % max;
  }
}

export interface RandomOptions {
  /** 4–64. */
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  /** Exclude Il1O0. */
  excludeAmbiguous: boolean;
}

export const DEFAULT_RANDOM_OPTIONS: RandomOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/',
} as const;
const AMBIGUOUS = /[Il1O0]/g;

export function generatePassword(opts: Partial<RandomOptions> = {}): string {
  const o = { ...DEFAULT_RANDOM_OPTIONS, ...opts };
  if (!Number.isInteger(o.length) || o.length < 4 || o.length > 64) {
    throw new RangeError('length must be 4–64');
  }
  const pools = (['upper', 'lower', 'digits', 'symbols'] as const)
    .filter((k) => o[k])
    .map((k) => (o.excludeAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  if (pools.length === 0) throw new Error('select at least one character set');

  const all = pools.join('');
  // Guarantee one char from every selected set, fill the rest uniformly, then shuffle.
  const chars = pools.map((p) => p[randomInt(p.length)]!);
  while (chars.length < o.length) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

export interface PassphraseOptions {
  /** 3–10. */
  words: number;
  separator: string;
  capitalize: boolean;
  appendDigit: boolean;
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 5,
  separator: '-',
  capitalize: false,
  appendDigit: false,
};

export function generatePassphrase(opts: Partial<PassphraseOptions> = {}): string {
  const o = { ...DEFAULT_PASSPHRASE_OPTIONS, ...opts };
  if (!Number.isInteger(o.words) || o.words < 3 || o.words > 10) {
    throw new RangeError('words must be 3–10');
  }
  const words = Array.from({ length: o.words }, () => {
    const w = EFF_WORDLIST[randomInt(EFF_WORDLIST.length)]!;
    return o.capitalize ? w[0]!.toUpperCase() + w.slice(1) : w;
  });
  if (o.appendDigit) words[words.length - 1] += String(randomInt(10));
  return words.join(o.separator);
}

/** Approximate entropy of a password drawn with `opts` (ignores the "one of each set" guarantee). */
export function randomEntropyBits(opts: Partial<RandomOptions> = {}): number {
  const o = { ...DEFAULT_RANDOM_OPTIONS, ...opts };
  const size = (['upper', 'lower', 'digits', 'symbols'] as const)
    .filter((k) => o[k])
    .reduce(
      (n, k) => n + (o.excludeAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]).length,
      0,
    );
  return size > 1 ? o.length * Math.log2(size) : 0;
}

/** Entropy of a passphrase: each word is uniform over the EFF list; a digit adds ~3.3 bits. */
export function passphraseEntropyBits(opts: Partial<PassphraseOptions> = {}): number {
  const words = opts.words ?? 5;
  return words * Math.log2(EFF_WORDLIST.length) + (opts.appendDigit ? Math.log2(10) : 0);
}

export type StrengthLabel = 'Weak' | 'Fair' | 'Good' | 'Strong' | 'Excellent';

/** Plain-language bucket and a 0–1 fill for a strength bar. */
export function strengthOf(bits: number): { label: StrengthLabel; level: number } {
  const label: StrengthLabel =
    bits < 40
      ? 'Weak'
      : bits < 60
        ? 'Fair'
        : bits < 80
          ? 'Good'
          : bits < 110
            ? 'Strong'
            : 'Excellent';
  return { label, level: Math.min(1, bits / 128) };
}
