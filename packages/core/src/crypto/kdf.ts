import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
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

/** Argon2id implementation: password and salt in, 32 raw bytes out. */
export type Argon2idFn = (
  password: string,
  salt: Uint8Array,
  params: KdfParams,
) => Promise<Uint8Array>;

/** Default: WebAssembly (browsers). Loaded lazily so runtimes without WASM can swap it first. */
const wasmArgon2: Argon2idFn = async (password, salt, params) => {
  const { argon2id } = await import('hash-wasm');
  return argon2id({
    password,
    salt,
    memorySize: params.m,
    iterations: params.t,
    parallelism: params.p,
    hashLength: 32,
    outputType: 'binary',
  });
};

let argon2Impl: Argon2idFn = wasmArgon2;

/** Android (Hermes has no WebAssembly) installs a native implementation at startup. */
export function setArgon2Implementation(fn: Argon2idFn | null): void {
  argon2Impl = fn ?? wasmArgon2;
}

export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  return argon2Impl(password.normalize('NFKC'), salt, params);
}

export function hkdfSha256(key: Uint8Array, info: string, length = 32): Uint8Array {
  return hkdf(sha256, key, undefined, utf8(info), length);
}

/** Auth key is sent to the server; KEK never leaves the client. */
export function deriveSubKeys(masterKey: Uint8Array): { authKey: Uint8Array; kek: Uint8Array } {
  return { authKey: hkdfSha256(masterKey, 'auth'), kek: hkdfSha256(masterKey, 'enc') };
}
