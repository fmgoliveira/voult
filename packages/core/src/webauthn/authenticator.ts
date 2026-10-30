import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, fromBase64Url, randomBytes, toBase64Url, utf8 } from '../crypto/bytes';
import type { Passkey } from '../vault/schemas';
import { cborEncode, type CborValue } from './cbor';

/**
 * Software WebAuthn authenticator (ES256, "none" attestation).
 * Flags: UP | UV | BE | BS (+ AT on registration) since passkeys sync across devices.
 */
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;
const BASE_FLAGS = FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS;

export interface ClientDataOptions {
  type: 'webauthn.create' | 'webauthn.get';
  /** Challenge exactly as the relying party supplied it, base64url. */
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export function buildClientDataJSON(o: ClientDataOptions): Uint8Array {
  return utf8(
    JSON.stringify({
      type: o.type,
      challenge: o.challenge,
      origin: o.origin,
      crossOrigin: o.crossOrigin ?? false,
    }),
  );
}

function uint32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

const rpIdHash = (rpId: string): Uint8Array => sha256(utf8(rpId));

function coseKey(publicKey: Uint8Array): Uint8Array {
  // publicKey is the uncompressed SEC1 point 0x04 || X || Y.
  return cborEncode(
    new Map<CborValue, CborValue>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, publicKey.slice(1, 33)],
      [-3, publicKey.slice(33, 65)],
    ]),
  );
}

export interface CreateParams {
  rpId: string;
  rpName?: string;
  /** Raw user handle bytes, base64url. */
  userHandle: string;
  userName?: string;
  clientDataJSON: Uint8Array;
  now?: number;
}

export interface CreateResult {
  /** Store this in the login item. */
  passkey: Passkey;
  credentialId: Uint8Array;
  clientDataJSON: Uint8Array;
  attestationObject: Uint8Array;
  authData: Uint8Array;
  /** COSE-encoded public key. */
  publicKey: Uint8Array;
}

export function createPasskey(p: CreateParams): CreateResult {
  const { secretKey } = p256.keygen();
  const pub = p256.getPublicKey(secretKey, false);
  const credentialId = randomBytes(32);
  const cose = coseKey(pub);
  const idLen = new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]);
  const authData = concat(
    rpIdHash(p.rpId),
    Uint8Array.of(BASE_FLAGS | FLAG_AT),
    uint32(0),
    new Uint8Array(16), // AAGUID: all zeros (none attestation)
    idLen,
    credentialId,
    cose,
  );
  const attestationObject = cborEncode(
    new Map<CborValue, CborValue>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]),
  );
  return {
    credentialId,
    clientDataJSON: p.clientDataJSON,
    attestationObject,
    authData,
    publicKey: cose,
    passkey: {
      credentialId: toBase64Url(credentialId),
      rpId: p.rpId,
      rpName: p.rpName ?? '',
      userHandle: p.userHandle,
      userName: p.userName ?? '',
      privateKey: toBase64Url(secretKey),
      signCount: 0,
      createdAt: p.now ?? Date.now(),
    },
  };
}

export interface AssertionResult {
  credentialId: Uint8Array;
  authData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** DER-encoded ECDSA signature. */
  signature: Uint8Array;
  userHandle: Uint8Array;
  /** The passkey with its sign counter advanced; persist it. */
  updated: Passkey;
}

export function getAssertion(passkey: Passkey, clientDataJSON: Uint8Array): AssertionResult {
  const signCount = passkey.signCount + 1;
  const authData = concat(rpIdHash(passkey.rpId), Uint8Array.of(BASE_FLAGS), uint32(signCount));
  const signature = p256.sign(
    concat(authData, sha256(clientDataJSON)),
    fromBase64Url(passkey.privateKey),
    { format: 'der' },
  );
  return {
    credentialId: fromBase64Url(passkey.credentialId),
    authData,
    clientDataJSON,
    signature,
    userHandle: fromBase64Url(passkey.userHandle),
    updated: { ...passkey, signCount },
  };
}

/** Passkeys usable for a request: matches rpId and, if given, the allowCredentials list. */
export function matchPasskeys(
  passkeys: Passkey[],
  rpId: string,
  allowCredentialIds?: string[],
): Passkey[] {
  return passkeys.filter(
    (k) =>
      k.rpId === rpId &&
      (!allowCredentialIds?.length || allowCredentialIds.includes(k.credentialId)),
  );
}

/** A page may only use an rpId equal to, or a registrable suffix of, its own host. */
export function isValidRpId(rpId: string, originHost: string): boolean {
  const host = originHost.toLowerCase();
  const id = rpId.toLowerCase();
  if (!id || id.includes('/') || id.includes(':')) return false;
  return host === id || host.endsWith(`.${id}`);
}
