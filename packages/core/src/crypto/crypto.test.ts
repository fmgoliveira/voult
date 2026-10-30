import { describe, expect, it } from 'vitest';
import { open, seal } from './aead';
import {
  concat,
  equalBytes,
  fromBase64Url,
  fromUtf8,
  randomBytes,
  toBase64Url,
  utf8,
} from './bytes';
import { deriveMasterKey, deriveSubKeys, hkdfSha256 } from './kdf';
import {
  changeMasterPassword,
  createAccount,
  decodeSecretKey,
  deriveLogin,
  encodeSecretKey,
  newKey,
  unlockAccountKey,
  unlockWithRecovery,
  unwrapKey,
  wrapKey,
} from './keys';

// Fast params for tests; the production defaults are benchmarked separately.
const FAST = { m: 64, t: 1, p: 1 };
const SALT = utf8('saltsaltsaltsalt');

describe('bytes', () => {
  it('round-trips base64url', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      expect(equalBytes(fromBase64Url(toBase64Url(b)), b)).toBe(true);
    }
    expect(toBase64Url(Uint8Array.from([251, 255]))).toBe('-_8');
  });
  it('concat, utf8, equalBytes', () => {
    expect(concat(Uint8Array.of(1), Uint8Array.of(2, 3))).toEqual(Uint8Array.of(1, 2, 3));
    expect(fromUtf8(utf8('héllo ✓'))).toBe('héllo ✓');
    expect(equalBytes(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
  });
});

describe('kdf', () => {
  it('Argon2id matches the RFC 9106 reference output shape and is deterministic', async () => {
    const a = await deriveMasterKey('password', SALT, FAST);
    const b = await deriveMasterKey('password', SALT, FAST);
    expect(a).toHaveLength(32);
    expect(equalBytes(a, b)).toBe(true);
    expect(equalBytes(a, await deriveMasterKey('Password', SALT, FAST))).toBe(false);
  });
  it('HKDF-SHA256 is length-correct and info-separated', () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    expect(hkdfSha256(ikm, 'a', 42)).toHaveLength(42);
    expect(equalBytes(hkdfSha256(ikm, 'a'), hkdfSha256(ikm, 'b'))).toBe(false);
  });
  it('derives distinct auth and enc keys', async () => {
    const { authKey, kek } = deriveSubKeys(await deriveMasterKey('pw', SALT, FAST));
    expect(equalBytes(authKey, kek)).toBe(false);
  });
  it('normalizes the password (NFKC)', async () => {
    const a = await deriveMasterKey('é', SALT, FAST);
    const b = await deriveMasterKey('é', SALT, FAST);
    expect(equalBytes(a, b)).toBe(true);
  });
  it('uses the spec defaults when params are omitted', async () => {
    expect(await deriveMasterKey('pw', SALT)).toHaveLength(32);
  });
});

describe('aead', () => {
  it('round-trips random inputs (fuzz)', () => {
    for (let i = 0; i < 200; i++) {
      const key = randomBytes(32);
      const pt = randomBytes(Math.floor(Math.random() * 300));
      const aad = toBase64Url(randomBytes(8));
      expect(equalBytes(open(key, seal(key, pt, aad), aad), pt)).toBe(true);
    }
  });
  it('uses a fresh nonce each time', () => {
    const key = randomBytes(32);
    expect(equalBytes(seal(key, utf8('a'), 'x'), seal(key, utf8('a'), 'x'))).toBe(false);
  });
  it('rejects tampering, wrong key, wrong AAD, truncation', () => {
    const key = randomBytes(32);
    const sealed = seal(key, utf8('secret'), 'item:1:1');
    const flipped = sealed.slice();
    flipped[flipped.length - 1]! ^= 1;
    expect(() => open(key, flipped, 'item:1:1')).toThrow();
    expect(() => open(newKey(), sealed, 'item:1:1')).toThrow();
    expect(() => open(key, sealed, 'item:1:2')).toThrow();
    expect(() => open(key, sealed.subarray(0, 20), 'item:1:1')).toThrow('too short');
  });
});

describe('keys', () => {
  it('wraps and unwraps, bound to context', () => {
    const kek = newKey();
    const k = newKey();
    const w = wrapKey(kek, k, 'ctx');
    expect(equalBytes(unwrapKey(kek, w, 'ctx'), k)).toBe(true);
    expect(() => unwrapKey(kek, w, 'other')).toThrow();
  });
  it('rejects wrapped payloads of the wrong length', () => {
    const kek = newKey();
    const w = toBase64Url(seal(kek, randomBytes(5), 'ctx'));
    expect(() => unwrapKey(kek, w, 'ctx')).toThrow('key length');
  });
  it('round-trips the printable secret key', () => {
    for (let i = 0; i < 50; i++) {
      const b = randomBytes(20);
      const text = encodeSecretKey(b);
      expect(text).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
      expect(equalBytes(decodeSecretKey(text.toLowerCase().replace(/-/g, ' ')), b)).toBe(true);
    }
    expect(() => decodeSecretKey('!!!')).toThrow('invalid');
  });

  it('creates an account, logs in, recovers, and changes password without touching items', async () => {
    const acc = await createAccount('correct horse', FAST);
    const login = await deriveLogin('correct horse', acc.material.salt, acc.material.kdfParams);
    expect(login.authKey).toBe(acc.material.authKey);
    expect(
      equalBytes(unlockAccountKey(login.kek, acc.material.wrappedAccountKey), acc.accountKey),
    ).toBe(true);

    const wrong = await deriveLogin('wrong', acc.material.salt, acc.material.kdfParams);
    expect(wrong.authKey).not.toBe(acc.material.authKey);
    expect(() => unlockAccountKey(wrong.kek, acc.material.wrappedAccountKey)).toThrow();

    expect(
      equalBytes(
        unlockWithRecovery(acc.recoverySecret, acc.material.wrappedRecoveryKey),
        acc.accountKey,
      ),
    ).toBe(true);

    const changed = await changeMasterPassword(acc.accountKey, 'new pass', FAST);
    const login2 = await deriveLogin('new pass', changed.salt, changed.kdfParams);
    expect(login2.authKey).toBe(changed.authKey);
    expect(
      equalBytes(unlockAccountKey(login2.kek, changed.wrappedAccountKey), acc.accountKey),
    ).toBe(true);
  });
});
