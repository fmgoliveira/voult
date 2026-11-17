import { createPrivateKey, sign as nodeSign, type KeyObject } from 'node:crypto';
import { toNodeKeyObjectInput } from '@voult/core';
import type { AgentKey } from '../keyring';
import { sshString, SIGN_FLAG } from './protocol';

const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]): Uint8Array => Buffer.concat(parts);

/** SSH `mpint` of an unsigned big-endian integer (RFC 4251 §5). */
function mpint(be: Uint8Array): Uint8Array {
  let i = 0;
  while (i < be.length - 1 && be[i] === 0) i++;
  const v = be.subarray(i);
  if (v.length === 1 && v[0] === 0) return sshString(new Uint8Array(0));
  return sshString(v[0]! & 0x80 ? cat(Uint8Array.of(0), v) : v);
}

export class SignError extends Error {}

/**
 * Sign `data` with a key from the vault and return the SSH signature blob
 * (`string algorithm || string signature`), per RFC 8709 (ed25519), RFC 8332 (rsa-sha2-*) and
 * RFC 5656 (ecdsa). Legacy `ssh-rsa` (SHA-1) signatures are refused.
 */
export function signWithKey(key: AgentKey, data: Uint8Array, flags: number): Uint8Array {
  let obj: KeyObject;
  try {
    obj = createPrivateKey({
      key: toNodeKeyObjectInput(Buffer.from(key.privateKey).toString('utf8')) as never,
      format: 'jwk',
    });
  } catch (e) {
    throw new SignError('key could not be loaded', { cause: e });
  }
  switch (key.keyType) {
    case 'ed25519':
      return cat(sshString(enc.encode('ssh-ed25519')), sshString(nodeSign(null, data, obj)));
    case 'rsa': {
      if (flags & SIGN_FLAG.RSA_SHA2_512) {
        return cat(sshString(enc.encode('rsa-sha2-512')), sshString(nodeSign('sha512', data, obj)));
      }
      if (flags & SIGN_FLAG.RSA_SHA2_256) {
        return cat(sshString(enc.encode('rsa-sha2-256')), sshString(nodeSign('sha256', data, obj)));
      }
      throw new SignError('ssh-rsa (SHA-1) signatures are not supported');
    }
    case 'ecdsa-p256':
    case 'ecdsa-p384': {
      const p256 = key.keyType === 'ecdsa-p256';
      const raw = nodeSign(p256 ? 'sha256' : 'sha384', data, {
        key: obj,
        dsaEncoding: 'ieee-p1363',
      });
      const half = raw.length / 2;
      const inner = cat(mpint(raw.subarray(0, half)), mpint(raw.subarray(half)));
      return cat(
        sshString(enc.encode(p256 ? 'ecdsa-sha2-nistp256' : 'ecdsa-sha2-nistp384')),
        sshString(inner),
      );
    }
  }
}
