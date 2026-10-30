import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concat, randomBytes, utf8 } from './bytes';

const NONCE_LEN = 24;

/** XChaCha20-Poly1305 with a random 24-byte nonce. Output: nonce || ciphertext+tag. */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Uint8Array {
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce, utf8(aad)).encrypt(plaintext);
  return concat(nonce, ct);
}

export function open(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  if (sealed.length < NONCE_LEN + 16) throw new Error('ciphertext too short');
  const nonce = sealed.subarray(0, NONCE_LEN);
  return xchacha20poly1305(key, nonce, utf8(aad)).decrypt(sealed.subarray(NONCE_LEN));
}
