import { concat } from '../crypto/bytes';

/** Minimal deterministic CBOR encoder for WebAuthn: ints, byte strings, text and maps. */
export type CborValue = number | string | Uint8Array | Map<CborValue, CborValue>;

function head(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

export function cborEncode(v: CborValue): Uint8Array {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    return concat(head(3, b.length), b);
  }
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  const parts: Uint8Array[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cborEncode(k), cborEncode(val));
  return concat(...parts);
}
