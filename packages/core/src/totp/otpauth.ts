import { totpSchema, type Totp } from '../vault/schemas';
import { base32Decode, base32Encode } from './totp';

/** Parse an `otpauth://totp|hotp/Label?secret=...` URI into a Totp entry. */
export function parseOtpauthUri(uri: string): Totp {
  const url = new URL(uri.trim());
  if (url.protocol !== 'otpauth:') throw new Error('not an otpauth URI');
  const kind = url.hostname.toLowerCase();
  if (kind !== 'totp' && kind !== 'hotp') throw new Error('unsupported otpauth type');

  const q = url.searchParams;
  const secret = q.get('secret');
  if (!secret) throw new Error('missing secret');
  base32Decode(secret); // throws on invalid base32

  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const colon = label.indexOf(':');
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : '';
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();

  return totpSchema.parse({
    kind,
    secret: secret.replace(/\s/g, '').toUpperCase(),
    algorithm: (q.get('algorithm') ?? 'SHA1').toUpperCase(),
    digits: Number(q.get('digits') ?? 6),
    period: Number(q.get('period') ?? 30),
    counter: Number(q.get('counter') ?? 0),
    issuer: q.get('issuer') ?? labelIssuer,
    account,
  });
}

export function buildOtpauthUri(t: Totp): string {
  const label = t.issuer ? `${t.issuer}:${t.account}` : t.account;
  const p = new URLSearchParams({ secret: t.secret });
  if (t.issuer) p.set('issuer', t.issuer);
  p.set('algorithm', t.algorithm);
  p.set('digits', String(t.digits));
  if (t.kind === 'hotp') p.set('counter', String(t.counter));
  else p.set('period', String(t.period));
  return `otpauth://${t.kind}/${encodeURIComponent(label)}?${p.toString()}`;
}

// --- Google Authenticator export: otpauth-migration://offline?data=<base64 protobuf> ---

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.buf.length;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error('truncated protobuf');
      const b = this.buf[this.pos++]!;
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
      if (shift > 63) throw new Error('varint too long');
    }
  }
  bytes(): Uint8Array {
    const len = this.varint();
    if (this.pos + len > this.buf.length) throw new Error('truncated protobuf');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 2) this.bytes();
    else if (wire === 1) this.pos += 8;
    else if (wire === 5) this.pos += 4;
    else throw new Error('unsupported wire type');
  }
}

const ALGS = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' } as const;

function parseOtpParameters(buf: Uint8Array): Totp {
  const r = new Reader(buf);
  let secret = new Uint8Array();
  let name = '';
  let issuer = '';
  let alg = 1;
  let digits = 1;
  let type = 2;
  let counter = 0;
  const dec = new TextDecoder();
  while (!r.done) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) secret = r.bytes();
    else if (field === 2 && wire === 2) name = dec.decode(r.bytes());
    else if (field === 3 && wire === 2) issuer = dec.decode(r.bytes());
    else if (field === 4 && wire === 0) alg = r.varint();
    else if (field === 5 && wire === 0) digits = r.varint();
    else if (field === 6 && wire === 0) type = r.varint();
    else if (field === 7 && wire === 0) counter = r.varint();
    else r.skip(wire);
  }
  if (!(alg in ALGS)) throw new Error('unsupported algorithm');
  if (type !== 1 && type !== 2) throw new Error('unsupported otp type');
  const colon = name.indexOf(':');
  return totpSchema.parse({
    kind: type === 1 ? 'hotp' : 'totp',
    secret: base32Encode(secret),
    algorithm: ALGS[alg as 1 | 2 | 3],
    digits: digits === 2 ? 8 : 6,
    counter,
    issuer: issuer || (colon >= 0 ? name.slice(0, colon).trim() : ''),
    account: (colon >= 0 ? name.slice(colon + 1) : name).trim(),
  });
}

export function parseMigrationUri(uri: string): Totp[] {
  const url = new URL(uri.trim());
  if (url.protocol !== 'otpauth-migration:') throw new Error('not a migration URI');
  const data = url.searchParams.get('data');
  if (!data) throw new Error('missing data');
  // URLSearchParams turns '+' into ' '; restore it.
  const bin = atob(data.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/'));
  const r = new Reader(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const out: Totp[] = [];
  while (!r.done) {
    const tag = r.varint();
    if (tag >>> 3 === 1 && (tag & 7) === 2) out.push(parseOtpParameters(r.bytes()));
    else r.skip(tag & 7);
  }
  return out;
}

/** Accepts either a plain otpauth:// URI or a migration URI; always returns a list. */
export function parseOtpQr(text: string): Totp[] {
  return text.trim().startsWith('otpauth-migration:')
    ? parseMigrationUri(text)
    : [parseOtpauthUri(text)];
}
