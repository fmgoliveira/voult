import { describe, expect, it } from 'vitest';
import { totpSchema } from '../vault/schemas';
import { buildOtpauthUri, parseMigrationUri, parseOtpauthUri, parseOtpQr } from './otpauth';
import { base32Decode, base32Encode, currentCode, hotp, nextCode, totp } from './totp';

const ascii = (s: string) => new TextEncoder().encode(s);

describe('HOTP (RFC 4226 Appendix D)', () => {
  const secret = ascii('12345678901234567890');
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  it.each(expected.map((c, i) => [i, c] as const))('counter %i -> %s', (i, code) => {
    expect(hotp(secret, i)).toBe(code);
  });
});

describe('TOTP (RFC 6238 Appendix B)', () => {
  const s1 = ascii('12345678901234567890');
  const s256 = ascii('12345678901234567890123456789012');
  const s512 = ascii('1234567890123456789012345678901234567890123456789012345678901234');
  const rows: [number, string, string, string][] = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  it.each(rows)('t=%i', (t, a, b, c) => {
    expect(totp(s1, t * 1000, 30, 8, 'SHA1')).toBe(a);
    expect(totp(s256, t * 1000, 30, 8, 'SHA256')).toBe(b);
    expect(totp(s512, t * 1000, 30, 8, 'SHA512')).toBe(c);
  });
});

describe('base32', () => {
  it('matches RFC 4648 vectors and round-trips', () => {
    expect(base32Encode(ascii('foobar'))).toBe('MZXW6YTBOI');
    expect(new TextDecoder().decode(base32Decode('MZXW6YTBOI======'))).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi')).toEqual(ascii('foobar'));
    expect(() => base32Decode('1')).toThrow('invalid base32');
  });
});

describe('currentCode / nextCode', () => {
  const entry = totpSchema.parse({
    secret: base32Encode(ascii('12345678901234567890')),
    digits: 8,
  });
  it('reports remaining time and progress', () => {
    const s = currentCode(entry, 59_000);
    expect(s.code).toBe('94287082');
    expect(s.remaining).toBe(1);
    expect(s.progress).toBeCloseTo(29 / 30);
    expect(nextCode(entry, 59_000)).toBe(totp(ascii('12345678901234567890'), 60_000, 30, 8));
  });
  it('handles HOTP entries', () => {
    const h = totpSchema.parse({ kind: 'hotp', secret: entry.secret, counter: 0, digits: 6 });
    expect(currentCode(h, 0)).toEqual({ code: '755224', remaining: 0, progress: 0 });
    expect(nextCode(h, 0)).toBe('287082');
  });
});

describe('otpauth URIs', () => {
  it('parses a full TOTP URI', () => {
    const t = parseOtpauthUri(
      'otpauth://totp/GitHub:octo%40cat.com?secret=jbsw y3dp&issuer=GitHub&algorithm=sha256&digits=8&period=60',
    );
    expect(t).toMatchObject({
      kind: 'totp',
      secret: 'JBSWY3DP',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      issuer: 'GitHub',
      account: 'octo@cat.com',
    });
  });
  it('falls back to label issuer and parses HOTP', () => {
    const t = parseOtpauthUri('otpauth://hotp/Acme:bob?secret=ABC&counter=5');
    expect(t).toMatchObject({ kind: 'hotp', counter: 5, issuer: 'Acme', account: 'bob' });
    expect(parseOtpauthUri('otpauth://totp/solo?secret=ABC').account).toBe('solo');
  });
  it('rejects bad input', () => {
    expect(() => parseOtpauthUri('https://x.com')).toThrow('not an otpauth');
    expect(() => parseOtpauthUri('otpauth://foo/x?secret=A')).toThrow('unsupported');
    expect(() => parseOtpauthUri('otpauth://totp/x')).toThrow('missing secret');
  });
  it('round-trips through buildOtpauthUri', () => {
    for (const t of [
      totpSchema.parse({ secret: 'ABCD', issuer: 'A B', account: 'me@x.com', period: 60 }),
      totpSchema.parse({ kind: 'hotp', secret: 'ABCD', counter: 3, account: 'solo' }),
    ]) {
      expect(parseOtpauthUri(buildOtpauthUri(t))).toEqual(t);
    }
  });
});

// Minimal protobuf encoder so we can build Google Authenticator export payloads.
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const lenField = (field: number, bytes: ArrayLike<number>) => [
  ...varint((field << 3) | 2),
  ...varint(bytes.length),
  ...Array.from(bytes),
];
const intField = (field: number, n: number) => [...varint(field << 3), ...varint(n)];

function otpParams(o: {
  secret: Uint8Array;
  name: string;
  issuer?: string;
  alg?: number;
  digits?: number;
  type?: number;
  counter?: number;
}) {
  return [
    ...lenField(1, o.secret),
    ...lenField(2, ascii(o.name)),
    ...(o.issuer ? lenField(3, ascii(o.issuer)) : []),
    ...intField(4, o.alg ?? 1),
    ...intField(5, o.digits ?? 1),
    ...intField(6, o.type ?? 2),
    ...(o.counter ? intField(7, o.counter) : []),
    ...intField(99, 1), // unknown field must be skipped
  ];
}
const toUri = (bytes: number[]) =>
  `otpauth-migration://offline?data=${encodeURIComponent(btoa(String.fromCharCode(...bytes)))}`;

describe('migration QR', () => {
  const payload = [
    ...lenField(
      1,
      otpParams({ secret: ascii('12345678901234567890'), name: 'GitHub:octo', alg: 2, digits: 2 }),
    ),
    ...lenField(
      1,
      otpParams({ secret: ascii('abc'), name: 'bob', issuer: 'Acme', type: 1, counter: 300 }),
    ),
    ...intField(2, 1),
    ...intField(3, 1),
    ...intField(4, 0),
    ...intField(5, 123),
  ];
  it('decodes multiple entries', () => {
    const [a, b] = parseMigrationUri(toUri(payload));
    expect(a).toMatchObject({
      kind: 'totp',
      algorithm: 'SHA256',
      digits: 8,
      issuer: 'GitHub',
      account: 'octo',
      secret: base32Encode(ascii('12345678901234567890')),
    });
    expect(b).toMatchObject({ kind: 'hotp', counter: 300, issuer: 'Acme', account: 'bob' });
  });
  it('parseOtpQr dispatches on scheme', () => {
    expect(parseOtpQr(toUri(payload))).toHaveLength(2);
    expect(parseOtpQr('otpauth://totp/x?secret=ABC')).toHaveLength(1);
  });
  it('accepts raw + in base64 and rejects malformed data', () => {
    const uri = toUri(payload).replace(/%2B/g, '+');
    expect(parseMigrationUri(uri)).toHaveLength(2);
    expect(() => parseMigrationUri('https://x')).toThrow('not a migration');
    expect(() => parseMigrationUri('otpauth-migration://offline')).toThrow('missing data');
    expect(() => parseMigrationUri(toUri([...lenField(1, [1, 2, 3]).slice(0, 3)]))).toThrow();
    expect(() =>
      parseMigrationUri(toUri(lenField(1, otpParams({ secret: ascii('a'), name: 'x', alg: 4 })))),
    ).toThrow('algorithm');
    expect(() =>
      parseMigrationUri(toUri(lenField(1, otpParams({ secret: ascii('a'), name: 'x', type: 0 })))),
    ).toThrow('otp type');
  });
  it('skips unknown top-level fields of various wire types', () => {
    const extra = [0x0d, 1, 2, 3, 4, 0x09, 1, 2, 3, 4, 5, 6, 7, 8]; // fixed32 + fixed64 (field 1 wire 5/1)
    expect(parseMigrationUri(toUri([...extra, ...payload]))).toHaveLength(2);
    expect(() => parseMigrationUri(toUri([0x0b]))).toThrow('wire type');
    expect(() => parseMigrationUri(toUri([0x08, 0x80]))).toThrow('truncated');
  });
});
