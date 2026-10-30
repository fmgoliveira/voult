import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { argon2id } from 'hash-wasm';
import { utf8 } from './bytes';

export interface KdfParams {
  /** Memory in KiB. */
  m: number;
  /** Iterations. */
  t: number;
  /** Parallelism. */
  p: number;
}

/** Spec: Argon2id, m = 64 MiB, t = 3, p = 1. */
export const DEFAULT_KDF_PARAMS: KdfParams = { m: 64 * 1024, t: 3, p: 1 };

export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  return argon2id({
    password: password.normalize('NFKC'),
    salt,
    memorySize: params.m,
    iterations: params.t,
    parallelism: params.p,
    hashLength: 32,
    outputType: 'binary',
  });
}

export function hkdfSha256(key: Uint8Array, info: string, length = 32): Uint8Array {
  return hkdf(sha256, key, undefined, utf8(info), length);
}

/** Auth key is sent to the server; KEK never leaves the client. */
export function deriveSubKeys(masterKey: Uint8Array): { authKey: Uint8Array; kek: Uint8Array } {
  return { authKey: hkdfSha256(masterKey, 'auth'), kek: hkdfSha256(masterKey, 'enc') };
}
