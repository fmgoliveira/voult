import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// bcrypt-pbkdf (16 rounds, pure JS) takes a second or two per passphrase operation.
vi.setConfig({ testTimeout: 60_000 });
import {
  fingerprintSha256,
  generateEd25519,
  parsePrivateKey,
  publicKeyBlob,
  publicKeyLine,
  serialisePrivateKey,
  SshKeyError,
  toNodeKeyObjectInput,
} from './keys';

const DIR = join(__dirname, '../../test/fixtures/ssh');
const read = (n: string) => readFileSync(join(DIR, n), 'utf8');
const PASS = 'voult-test';
const fingerprints = new Map(
  read('fingerprints.txt')
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      const [name, , fp] = l.split(' ');
      return [name!, fp!] as const;
    }),
);

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SshKeyError);
    expect((e as SshKeyError).code).toBe(code);
    return;
  }
  throw new Error('expected a throw');
};

/** `ssh-keygen` is on dev machines and CI runners; the interop checks are skipped without it. */
const hasKeygen = (() => {
  try {
    execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return (e as { status?: number }).status !== undefined;
  }
})();

const openssh = [
  ['ed25519', 'ed25519', ''],
  ['ed25519-pass', 'ed25519', PASS],
  ['ed25519-gcm', 'ed25519', PASS],
  ['rsa2048', 'rsa', ''],
  ['rsa2048-pass', 'rsa', PASS],
  ['rsa3072', 'rsa', ''],
  ['rsa3072-pass', 'rsa', PASS],
  ['ecdsa256', 'ecdsa-p256', ''],
  ['ecdsa256-pass', 'ecdsa-p256', PASS],
  ['ecdsa384', 'ecdsa-p384', ''],
  ['ecdsa384-pass', 'ecdsa-p384', PASS],
] as const;

const keyAndBlob = (line: string) => line.split(' ').slice(0, 2).join(' ');

describe('parsePrivateKey (OpenSSH format, matches ssh-keygen)', () => {
  it.each(openssh)('%s', (name, keyType, pass) => {
    const k = parsePrivateKey(read(name), pass);
    const pub = read(`${name}.pub`).trim();
    expect(k.keyType).toBe(keyType);
    expect(k.publicKey).toBe(pub);
    expect(k.comment).toBe(pub.split(' ')[2]);
    expect(k.fingerprint).toBe(fingerprints.get(name));
    expect(k.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
    // Parse -> serialise -> parse is stable.
    expect(parsePrivateKey(k.privateKey)).toMatchObject({
      publicKey: k.publicKey,
      fingerprint: k.fingerprint,
    });
    if (['ed25519', 'rsa2048', 'ecdsa384'].includes(name)) {
      const enc = serialisePrivateKey(k.privateKey, k.comment, 'a new passphrase');
      expect(enc).not.toBe(k.privateKey);
      expect(parsePrivateKey(enc, 'a new passphrase').fingerprint).toBe(k.fingerprint);
    }
  });

  it('copes with CRLF line endings', () => {
    const crlf = read('ed25519').replace(/\r?\n/g, '\r\n');
    expect(parsePrivateKey(crlf).fingerprint).toBe(fingerprints.get('ed25519'));
  });

  it('reports passphrase problems', () => {
    expectCode(() => parsePrivateKey(read('ed25519-pass')), 'PassphraseRequired');
    expectCode(() => parsePrivateKey(read('ed25519-pass'), 'nope'), 'WrongPassphrase');
    expectCode(() => parsePrivateKey(read('rsa2048-pass'), 'nope'), 'WrongPassphrase');
    expectCode(() => parsePrivateKey(read('ed25519-gcm'), 'nope'), 'WrongPassphrase');
  });
});

describe('parsePrivateKey (PEM)', () => {
  it.each([
    ['rsa-pkcs1', 'rsa'],
    ['rsa-pkcs8', 'rsa'],
    ['ecdsa-sec1', 'ecdsa-p256'],
    ['ecdsa-pkcs8', 'ecdsa-p384'],
    ['ed25519-pkcs8', 'ed25519'],
  ])('%s', (name, keyType) => {
    const k = parsePrivateKey(read(name));
    expect(k.keyType).toBe(keyType);
    expect(k.fingerprint).toBe(fingerprints.get(name));
    expect(keyAndBlob(k.publicKey)).toBe(keyAndBlob(read(`${name}.pub`).trim()));
  });

  const pem = (label: string, body: string) =>
    `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;

  it('rejects short RSA keys, encrypted PEM, garbage and unknown formats', () => {
    expectCode(() => parsePrivateKey(read('rsa1024')), 'RsaTooShort');
    expectCode(() => parsePrivateKey(read('rsa-pkcs1-enc'), PASS), 'UnsupportedKeyType');
    expectCode(() => parsePrivateKey('nonsense'), 'InvalidKey');
    expectCode(() => parsePrivateKey(pem('DSA PRIVATE KEY', 'AAAA')), 'UnsupportedKeyType');
    expectCode(() => parsePrivateKey(pem('PRIVATE KEY', '@@@')), 'InvalidKey');
    expectCode(() => parsePrivateKey(pem('PRIVATE KEY', 'AAAA')), 'InvalidKey');
    expectCode(() => parsePrivateKey(pem('OPENSSH PRIVATE KEY', 'AAAA')), 'InvalidKey');
    expectCode(() => serialisePrivateKey('nope', ''), 'InvalidKey');
    expectCode(() => serialisePrivateKey(pem('OPENSSH PRIVATE KEY', '@@@'), ''), 'InvalidKey');
    expectCode(() => toNodeKeyObjectInput('nope'), 'InvalidKey');
  });

  it('rejects truncated and tampered key files', () => {
    const good = read('ed25519').replace(/-----[A-Z ]+-----|\s/g, '');
    const cut = (n: number) => pem('OPENSSH PRIVATE KEY', good.slice(0, n));
    expectCode(() => parsePrivateKey(cut(40)), 'InvalidKey');
    expectCode(() => parsePrivateKey(cut(120)), 'InvalidKey');
    // Corrupt the first check int (offset 98: header, ciphers, public key, section length).
    const bytes = Uint8Array.from(atob(good), (c) => c.charCodeAt(0));
    bytes[100] = bytes[100]! ^ 0xff;
    const bad = btoa(String.fromCharCode(...bytes));
    expect(() => parsePrivateKey(pem('OPENSSH PRIVATE KEY', bad))).toThrow(SshKeyError);
  });
});

describe('malformed OpenSSH containers', () => {
  const unwrap = (name: string) =>
    Uint8Array.from(atob(read(name).replace(/-----[A-Z ]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const wrap = (b: Uint8Array) =>
    `-----BEGIN OPENSSH PRIVATE KEY-----\n${btoa(String.fromCharCode(...b))}\n-----END OPENSSH PRIVATE KEY-----`;
  /** Overwrite the nth occurrence of `find` (same length replacement). */
  const patch = (b: Uint8Array, find: string, repl: string, nth = 0) => {
    const text = String.fromCharCode(...b);
    let at = -1;
    for (let i = 0; i <= nth; i++) at = text.indexOf(find, at + 1);
    expect(at).toBeGreaterThanOrEqual(0);
    const out = b.slice();
    for (let i = 0; i < repl.length; i++) out[at + i] = repl.charCodeAt(i);
    return out;
  };

  it('rejects a bad magic, several keys, unknown ciphers and kdfs, and mismatched kdf', () => {
    const plain = unwrap('ed25519');
    expectCode(
      () => parsePrivateKey(wrap(patch(plain, 'openssh-key-v1', 'openssh-key-v2'))),
      'InvalidKey',
    );
    // cipher "none" with kdf "bcry" (the second "none" is the kdf name)
    expectCode(() => parsePrivateKey(wrap(patch(plain, 'none', 'bcry', 1))), 'InvalidKey');
    const enc = unwrap('ed25519-pass');
    expectCode(
      () => parsePrivateKey(wrap(patch(enc, 'aes256-ctr', 'aes256-xyz')), PASS),
      'UnsupportedKeyType',
    );
    expectCode(
      () => parsePrivateKey(wrap(patch(enc, 'bcrypt', 'scrypt')), PASS),
      'UnsupportedKeyType',
    );
    // nkeys sits after "none" "none" and the empty kdf options: 15 + 8 + 8 + 4 bytes in.
    const two = plain.slice();
    two[15 + 8 + 8 + 4 + 3] = 2;
    expectCode(() => parsePrivateKey(wrap(two)), 'InvalidKey');
  });

  it('rejects an unsupported key type inside the container', () => {
    const inner = patch(unwrap('ed25519'), 'ssh-ed25519', 'ssh-dss-2519', 1);
    expectCode(() => parsePrivateKey(wrap(inner)), 'UnsupportedKeyType');
  });
});

describe('public key helpers', () => {
  it('rebuild the authorized_keys line and fingerprint from a blob', () => {
    const line = read('ed25519.pub').trim();
    const blob = publicKeyBlob(line);
    expect(publicKeyLine(blob, 'fixture-ed25519')).toBe(line);
    expect(publicKeyLine(blob)).toBe(line.replace(' fixture-ed25519', ''));
    expect(fingerprintSha256(blob)).toBe(fingerprints.get('ed25519'));
    expect(() => publicKeyBlob('ssh-ed25519')).toThrow(SshKeyError);
    expect(() => publicKeyBlob('ssh-ed25519 @@@')).toThrow(SshKeyError);
  });
});

describe('generateEd25519', () => {
  it('makes a distinct, valid key each time', () => {
    const a = generateEd25519('me@laptop');
    const b = generateEd25519();
    expect(a.keyType).toBe('ed25519');
    expect(a.publicKey).toMatch(/^ssh-ed25519 AAAA\S+ me@laptop$/);
    expect(b.publicKey).not.toBe(a.publicKey);
    expect(a.fingerprint).toBe(fingerprintSha256(publicKeyBlob(a.publicKey)));
    expect(parsePrivateKey(a.privateKey).fingerprint).toBe(a.fingerprint);
  });
});

describe('toNodeKeyObjectInput', () => {
  it.each(['ed25519', 'rsa2048', 'ecdsa256', 'ecdsa384'])('%s signs and verifies', (name) => {
    const k = parsePrivateKey(read(name));
    const priv = createPrivateKey({
      key: toNodeKeyObjectInput(k.privateKey) as never,
      format: 'jwk',
    });
    const pub = createPublicKey(priv);
    const data = Buffer.from('hello');
    const alg = priv.asymmetricKeyType === 'ed25519' ? null : 'sha256';
    expect(verify(alg, data, pub, sign(alg, data, priv))).toBe(true);
  });
});

describe.skipIf(!hasKeygen)('ssh-keygen interop', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'voult-ssh-'));
  let n = 0;
  const keygenY = (privateKey: string, pass = '') => {
    const f = join(tmp, `k${n++}`);
    writeFileSync(f, privateKey, { mode: 0o600 });
    return execFileSync('ssh-keygen', ['-y', '-P', pass, '-f', f], { encoding: 'utf8' }).trim();
  };

  it('loads generated keys and prints the same public key', () => {
    const k = generateEd25519('gen');
    expect(keygenY(k.privateKey)).toBe(k.publicKey);
  });

  it.each(['ed25519', 'rsa2048', 'ecdsa256', 'ecdsa384-pass'])(
    'loads re-serialised %s, plain and encrypted',
    (name) => {
      const k = parsePrivateKey(read(name), name.endsWith('-pass') ? PASS : '');
      const pub = keyAndBlob(k.publicKey);
      expect(keyAndBlob(keygenY(k.privateKey))).toBe(pub);
      const enc = serialisePrivateKey(k.privateKey, k.comment, 'round trip');
      expect(keyAndBlob(keygenY(enc, 'round trip'))).toBe(pub);
    },
  );

  it('agrees with ssh-keygen -lf on the fingerprint', () => {
    const k = generateEd25519('fp');
    const f = join(tmp, 'gen.pub');
    writeFileSync(f, k.publicKey + '\n');
    expect(execFileSync('ssh-keygen', ['-lf', f], { encoding: 'utf8' })).toContain(k.fingerprint);
    rmSync(tmp, { recursive: true, force: true });
  });
});
