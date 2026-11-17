/**
 * OpenSSH key codec: parse (OpenSSH `openssh-key-v1`, PEM PKCS#1/SEC1/PKCS#8), serialise
 * (optionally passphrase-encrypted), public key line, SHA-256 fingerprint and a JWK form that
 * `node:crypto` can sign with.
 *
 * bcrypt-pbkdf (the OpenSSH key derivation) is not in @noble/hashes, so the audited
 * `bcrypt-pbkdf` package (a 1:1 port of the OpenBSD reference, used by ssh2) is used for it.
 */
import { ctr, gcm } from '@noble/ciphers/aes.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256, p384 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import bcrypt from 'bcrypt-pbkdf';
import { concat, fromUtf8, randomBytes, toBase64Url, utf8 } from '../crypto/bytes';
import type { SshKeyType } from '../vault/schemas';

export type SshKeyErrorCode =
  'WrongPassphrase' | 'PassphraseRequired' | 'UnsupportedKeyType' | 'RsaTooShort' | 'InvalidKey';

export class SshKeyError extends Error {
  constructor(
    readonly code: SshKeyErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SshKeyError';
  }
}

const MIN_RSA_BITS = 2048;
const BCRYPT_ROUNDS = 16;
const MAGIC = utf8('openssh-key-v1\0');

// ------------------------------------------------------------------ byte helpers

const b64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const u32 = (n: number): Uint8Array =>
  Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const str = (b: Uint8Array): Uint8Array => concat(u32(b.length), b);

function bigToBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
}
function bytesToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}
/** SSH `mpint`: big-endian two's complement, no leading zeros (one 0x00 if the top bit is set). */
function mpint(n: bigint): Uint8Array {
  const b = bigToBytes(n);
  return str(b.length && (b[0]! & 0x80) !== 0 ? concat(Uint8Array.of(0), b) : b);
}
const padTo = (b: Uint8Array, len: number): Uint8Array => {
  if (b.length > len) throw new SshKeyError('InvalidKey');
  const out = new Uint8Array(len);
  out.set(b, len - b.length);
  return out;
};

class Reader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  get rest(): number {
    return this.b.length - this.o;
  }
  u32(): number {
    if (this.rest < 4) throw new SshKeyError('InvalidKey');
    const v =
      this.b[this.o]! * 0x1000000 +
      (this.b[this.o + 1]! << 16) +
      (this.b[this.o + 2]! << 8) +
      this.b[this.o + 3]!;
    this.o += 4;
    return v;
  }
  raw(n: number): Uint8Array {
    if (n < 0 || this.rest < n) throw new SshKeyError('InvalidKey');
    const out = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return out;
  }
  string(): Uint8Array {
    return this.raw(this.u32());
  }
  text(): string {
    return fromUtf8(this.string());
  }
  mpint(): bigint {
    return bytesToBig(this.string());
  }
}

// ------------------------------------------------------------------ key material

type Curve = 'nistp256' | 'nistp384';
type Material =
  | { kind: 'ed25519'; seed: Uint8Array }
  | { kind: 'rsa'; n: bigint; e: bigint; d: bigint; iqmp: bigint; p: bigint; q: bigint }
  | { kind: 'ecdsa'; curve: Curve; d: bigint };

const CURVES = {
  nistp256: { lib: p256, size: 32, type: 'ecdsa-p256' as const },
  nistp384: { lib: p384, size: 48, type: 'ecdsa-p384' as const },
};

const keyTypeOf = (m: Material): SshKeyType =>
  m.kind === 'ed25519' ? 'ed25519' : m.kind === 'rsa' ? 'rsa' : CURVES[m.curve].type;

function checkRsa(m: Extract<Material, { kind: 'rsa' }>): void {
  if (m.n.toString(2).length < MIN_RSA_BITS) throw new SshKeyError('RsaTooShort');
}

function ecPoint(m: Extract<Material, { kind: 'ecdsa' }>): Uint8Array {
  const c = CURVES[m.curve];
  return c.lib.getPublicKey(padTo(bigToBytes(m.d), c.size), false);
}

/** The SSH wire-format public key blob (RFC 4253 / 5656 / 8709). */
function publicBlob(m: Material): Uint8Array {
  if (m.kind === 'ed25519') {
    return concat(str(utf8('ssh-ed25519')), str(ed25519.getPublicKey(m.seed)));
  }
  if (m.kind === 'rsa') return concat(str(utf8('ssh-rsa')), mpint(m.e), mpint(m.n));
  return concat(str(utf8(`ecdsa-sha2-${m.curve}`)), str(utf8(m.curve)), str(ecPoint(m)));
}

const blobTypeName = (blob: Uint8Array): string => new Reader(blob).text();

/** `ssh-ed25519 AAAA… comment` */
export function publicKeyLine(blob: Uint8Array, comment = ''): string {
  return `${blobTypeName(blob)} ${b64(blob)}${comment ? ' ' + comment : ''}`;
}

/** `SHA256:…` (base64 without padding), as `ssh-keygen -lf` prints it. */
export function fingerprintSha256(blob: Uint8Array): string {
  return 'SHA256:' + b64(sha256(blob)).replace(/=+$/, '');
}

/** Wire-format blob from an authorized_keys style line. */
export function publicKeyBlob(line: string): Uint8Array {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) throw new SshKeyError('InvalidKey');
  try {
    return unb64(parts[1]!);
  } catch {
    throw new SshKeyError('InvalidKey');
  }
}

// ------------------------------------------------------------------ OpenSSH format

const CIPHERS: Record<string, { key: number; iv: number; block: number; mode: 'ctr' | 'gcm' }> = {
  'aes128-ctr': { key: 16, iv: 16, block: 16, mode: 'ctr' },
  'aes192-ctr': { key: 24, iv: 16, block: 16, mode: 'ctr' },
  'aes256-ctr': { key: 32, iv: 16, block: 16, mode: 'ctr' },
  'aes256-gcm@openssh.com': { key: 32, iv: 12, block: 16, mode: 'gcm' },
};
const GCM_TAG = 16;

function deriveKey(passphrase: string, salt: Uint8Array, rounds: number, len: number): Uint8Array {
  const pass = utf8(passphrase);
  const out = new Uint8Array(len);
  if (!pass.length || bcrypt.pbkdf(pass, pass.length, salt, salt.length, out, len, rounds) !== 0) {
    throw new SshKeyError('InvalidKey');
  }
  return out;
}

function decodeOpenSsh(blob: Uint8Array, passphrase: string): { m: Material; comment: string } {
  const r = new Reader(blob);
  const magic = r.raw(MAGIC.length);
  if (!magic.every((x, i) => x === MAGIC[i])) throw new SshKeyError('InvalidKey');
  const cipherName = r.text();
  const kdfName = r.text();
  const kdfOptions = r.string();
  if (r.u32() !== 1) throw new SshKeyError('InvalidKey', 'only single-key files are supported');
  r.string(); // public key (re-derived from the private section)
  const sealed = r.string();

  let priv: Uint8Array;
  if (cipherName === 'none') {
    if (kdfName !== 'none') throw new SshKeyError('InvalidKey');
    priv = sealed;
  } else {
    const spec = CIPHERS[cipherName];
    if (!spec || kdfName !== 'bcrypt') throw new SshKeyError('UnsupportedKeyType', cipherName);
    if (!passphrase) throw new SshKeyError('PassphraseRequired');
    const o = new Reader(kdfOptions);
    const material = deriveKey(passphrase, o.string(), o.u32(), spec.key + spec.iv);
    const key = material.subarray(0, spec.key);
    const iv = material.subarray(spec.key);
    try {
      priv =
        spec.mode === 'gcm'
          ? gcm(key, iv).decrypt(concat(sealed, r.raw(GCM_TAG)))
          : ctr(key, iv).decrypt(sealed);
    } catch {
      throw new SshKeyError('WrongPassphrase');
    }
  }

  const p = new Reader(priv);
  const c1 = p.u32();
  if (c1 !== p.u32()) {
    throw new SshKeyError(cipherName === 'none' ? 'InvalidKey' : 'WrongPassphrase');
  }
  const type = p.text();
  let m: Material;
  if (type === 'ssh-ed25519') {
    p.string(); // public
    const secret = p.string();
    if (secret.length !== 64) throw new SshKeyError('InvalidKey');
    m = { kind: 'ed25519', seed: secret.slice(0, 32) };
  } else if (type === 'ssh-rsa') {
    const n = p.mpint();
    const e = p.mpint();
    const d = p.mpint();
    const iqmp = p.mpint();
    const pp = p.mpint();
    const q = p.mpint();
    m = { kind: 'rsa', n, e, d, iqmp, p: pp, q };
    checkRsa(m);
  } else if (type === 'ecdsa-sha2-nistp256' || type === 'ecdsa-sha2-nistp384') {
    const curve = type.slice('ecdsa-sha2-'.length) as Curve;
    p.string(); // curve name
    p.string(); // Q
    m = { kind: 'ecdsa', curve, d: p.mpint() };
  } else {
    throw new SshKeyError('UnsupportedKeyType', type);
  }
  return { m, comment: p.text() };
}

function privateSection(m: Material, comment: string, block: number): Uint8Array {
  const check = randomBytes(4);
  let body: Uint8Array;
  if (m.kind === 'ed25519') {
    const pub = ed25519.getPublicKey(m.seed);
    body = concat(str(utf8('ssh-ed25519')), str(pub), str(concat(m.seed, pub)));
  } else if (m.kind === 'rsa') {
    body = concat(
      str(utf8('ssh-rsa')),
      mpint(m.n),
      mpint(m.e),
      mpint(m.d),
      mpint(m.iqmp),
      mpint(m.p),
      mpint(m.q),
    );
  } else {
    body = concat(
      str(utf8(`ecdsa-sha2-${m.curve}`)),
      str(utf8(m.curve)),
      str(ecPoint(m)),
      mpint(m.d),
    );
  }
  const unpadded = concat(check, check, body, str(utf8(comment)));
  const pad = (block - (unpadded.length % block)) % block;
  return concat(
    unpadded,
    Uint8Array.from({ length: pad }, (_, i) => i + 1),
  );
}

function encodeOpenSsh(m: Material, comment: string, passphrase: string): string {
  let cipherName = 'none';
  let kdfName = 'none';
  let kdfOptions: Uint8Array = new Uint8Array(0);
  let section: Uint8Array;
  if (!passphrase) {
    section = privateSection(m, comment, 8);
  } else {
    cipherName = 'aes256-ctr';
    kdfName = 'bcrypt';
    const spec = CIPHERS[cipherName]!;
    const salt = randomBytes(16);
    kdfOptions = concat(str(salt), u32(BCRYPT_ROUNDS));
    const material = deriveKey(passphrase, salt, BCRYPT_ROUNDS, spec.key + spec.iv);
    section = ctr(material.subarray(0, spec.key), material.subarray(spec.key)).encrypt(
      privateSection(m, comment, spec.block),
    );
  }
  const file = concat(
    MAGIC,
    str(utf8(cipherName)),
    str(utf8(kdfName)),
    str(kdfOptions),
    u32(1),
    str(publicBlob(m)),
    str(section),
  );
  const body = b64(file)
    .match(/.{1,70}/g)!
    .join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** Decode a stored, unencrypted OpenSSH private key. */
function decodeStored(privateKey: string): { m: Material; comment: string } {
  const body =
    /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(
      privateKey,
    )?.[1];
  if (!body) throw new SshKeyError('InvalidKey');
  let bytes: Uint8Array;
  try {
    bytes = unb64(body.replace(/\s+/g, ''));
  } catch {
    throw new SshKeyError('InvalidKey');
  }
  return decodeOpenSsh(bytes, '');
}

// ------------------------------------------------------------------ ASN.1 DER (PEM keys)

interface Der {
  tag: number;
  body: Uint8Array;
}
class DerReader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  get done(): boolean {
    return this.o >= this.b.length;
  }
  next(): Der {
    const tag = this.b[this.o++];
    let len = this.b[this.o++];
    if (tag === undefined || len === undefined) throw new SshKeyError('InvalidKey');
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n < 1 || n > 4) throw new SshKeyError('InvalidKey');
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + (this.b[this.o++] ?? 0);
    }
    if (this.o + len > this.b.length) throw new SshKeyError('InvalidKey');
    const body = this.b.subarray(this.o, this.o + len);
    this.o += len;
    return { tag, body };
  }
  expect(tag: number): Uint8Array {
    const d = this.next();
    if (d.tag !== tag) throw new SshKeyError('InvalidKey');
    return d.body;
  }
}
const SEQ = 0x30;
const INT = 0x02;
const OCT = 0x04;
const OID = 0x06;

const oidHex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const OID_RSA = '2a864886f70d010101';
const OID_EC = '2a8648ce3d0201';
const OID_ED25519 = '2b6570';
const OID_CURVES: Record<string, Curve> = {
  '2a8648ce3d030107': 'nistp256',
  '2b81040022': 'nistp384',
};

const derInt = (r: DerReader): bigint => bytesToBig(r.expect(INT));

function rsaFromPkcs1(der: Uint8Array): Material {
  const r = new DerReader(new DerReader(der).expect(SEQ));
  derInt(r); // version
  const n = derInt(r);
  const e = derInt(r);
  const d = derInt(r);
  const p = derInt(r);
  const q = derInt(r);
  derInt(r); // dp
  derInt(r); // dq
  const iqmp = derInt(r);
  const m: Material = { kind: 'rsa', n, e, d, iqmp, p, q };
  checkRsa(m);
  return m;
}

function ecFromSec1(der: Uint8Array, curveHint?: Curve): Material {
  const r = new DerReader(new DerReader(der).expect(SEQ));
  derInt(r); // version
  const d = bytesToBig(r.expect(OCT));
  let curve = curveHint;
  while (!r.done) {
    const f = r.next();
    if (f.tag === 0xa0) {
      curve = OID_CURVES[oidHex(new DerReader(f.body).expect(OID))] ?? curve;
    }
  }
  if (!curve) throw new SshKeyError('UnsupportedKeyType', 'EC curve');
  return { kind: 'ecdsa', curve, d };
}

function fromPkcs8(der: Uint8Array): Material {
  const r = new DerReader(new DerReader(der).expect(SEQ));
  derInt(r); // version
  const alg = new DerReader(r.expect(SEQ));
  const oid = oidHex(alg.expect(OID));
  const inner = r.expect(OCT);
  if (oid === OID_RSA) return rsaFromPkcs1(inner);
  if (oid === OID_ED25519) {
    const seed = new DerReader(inner).expect(OCT);
    if (seed.length !== 32) throw new SshKeyError('InvalidKey');
    return { kind: 'ed25519', seed: seed.slice() };
  }
  if (oid === OID_EC) {
    const curve = OID_CURVES[oidHex(alg.expect(OID))];
    if (!curve) throw new SshKeyError('UnsupportedKeyType', 'EC curve');
    return ecFromSec1(inner, curve);
  }
  throw new SshKeyError('UnsupportedKeyType', oid);
}

// ------------------------------------------------------------------ public API

export interface ParsedSshKey {
  keyType: SshKeyType;
  /** Normalised, unencrypted OpenSSH private key. */
  privateKey: string;
  publicKey: string;
  fingerprint: string;
  comment: string;
}

function describe(m: Material, comment: string): ParsedSshKey {
  const blob = publicBlob(m);
  return {
    keyType: keyTypeOf(m),
    privateKey: encodeOpenSsh(m, comment, ''),
    publicKey: publicKeyLine(blob, comment),
    fingerprint: fingerprintSha256(blob),
    comment,
  };
}

/** Generate a fresh ed25519 key. */
export function generateEd25519(comment = ''): ParsedSshKey {
  return describe({ kind: 'ed25519', seed: ed25519.utils.randomSecretKey() }, comment);
}

/** Parse an OpenSSH or PEM private key, decrypting an OpenSSH key with `passphrase` if needed. */
export function parsePrivateKey(text: string, passphrase = ''): ParsedSshKey {
  const match = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!match) throw new SshKeyError('InvalidKey');
  const label = match[1]!;
  const inner = match[2]!;
  if (/Proc-Type:\s*4,ENCRYPTED/i.test(inner) || label === 'ENCRYPTED PRIVATE KEY') {
    throw new SshKeyError(
      'UnsupportedKeyType',
      'encrypted PEM keys are not supported; convert with ssh-keygen -p',
    );
  }
  let der: Uint8Array;
  try {
    der = unb64(inner.replace(/\s+/g, ''));
  } catch {
    throw new SshKeyError('InvalidKey');
  }
  let parsed: { m: Material; comment: string };
  if (label === 'OPENSSH PRIVATE KEY') parsed = decodeOpenSsh(der, passphrase);
  else if (label === 'RSA PRIVATE KEY') parsed = { m: rsaFromPkcs1(der), comment: '' };
  else if (label === 'EC PRIVATE KEY') parsed = { m: ecFromSec1(der), comment: '' };
  else if (label === 'PRIVATE KEY') parsed = { m: fromPkcs8(der), comment: '' };
  else throw new SshKeyError('UnsupportedKeyType', label);
  return describe(parsed.m, parsed.comment);
}

/** Re-serialise a stored (unencrypted) key, encrypting it with `passphrase` when one is given. */
export function serialisePrivateKey(privateKey: string, comment: string, passphrase = ''): string {
  return encodeOpenSsh(decodeStored(privateKey).m, comment, passphrase);
}

/** Input for `crypto.createPrivateKey({ key, format: 'jwk' })` in Node. */
export type NodeKeyInput =
  | { kty: 'OKP'; crv: 'Ed25519'; d: string; x: string }
  | { kty: 'EC'; crv: 'P-256' | 'P-384'; d: string; x: string; y: string }
  | {
      kty: 'RSA';
      n: string;
      e: string;
      d: string;
      p: string;
      q: string;
      dp: string;
      dq: string;
      qi: string;
    };

/** A JWK for a stored private key, loadable with `createPrivateKey({ key, format: 'jwk' })`. */
export function toNodeKeyObjectInput(privateKey: string): NodeKeyInput {
  const { m } = decodeStored(privateKey);
  const enc = (n: bigint) => toBase64Url(bigToBytes(n));
  if (m.kind === 'ed25519') {
    return {
      kty: 'OKP',
      crv: 'Ed25519',
      d: toBase64Url(m.seed),
      x: toBase64Url(ed25519.getPublicKey(m.seed)),
    };
  }
  if (m.kind === 'rsa') {
    return {
      kty: 'RSA',
      n: enc(m.n),
      e: enc(m.e),
      d: enc(m.d),
      p: enc(m.p),
      q: enc(m.q),
      dp: enc(m.d % (m.p - 1n)),
      dq: enc(m.d % (m.q - 1n)),
      qi: enc(m.iqmp),
    };
  }
  const c = CURVES[m.curve];
  const q = ecPoint(m); // 0x04 || X || Y
  return {
    kty: 'EC',
    crv: m.curve === 'nistp256' ? 'P-256' : 'P-384',
    d: toBase64Url(padTo(bigToBytes(m.d), c.size)),
    x: toBase64Url(q.slice(1, 1 + c.size)),
    y: toBase64Url(q.slice(1 + c.size)),
  };
}
