import { fromBase64Url, randomBytes, toBase64Url } from './bytes';
import { open, seal } from './aead';
import {
  DEFAULT_KDF_PARAMS,
  deriveMasterKey,
  deriveSubKeys,
  hkdfSha256,
  type KdfParams,
} from './kdf';

const KEY_LEN = 32;

export const newKey = (): Uint8Array => randomBytes(KEY_LEN);

/** Wrap `key` under `wrappingKey`. `context` binds the wrap to its purpose/identity. */
export function wrapKey(wrappingKey: Uint8Array, key: Uint8Array, context: string): string {
  return toBase64Url(seal(wrappingKey, key, context));
}

export function unwrapKey(wrappingKey: Uint8Array, wrapped: string, context: string): Uint8Array {
  const key = open(wrappingKey, fromBase64Url(wrapped), context);
  if (key.length !== KEY_LEN) throw new Error('unexpected key length');
  return key;
}

const ACCOUNT_CTX = 'voult:account-key';
const RECOVERY_CTX = 'voult:account-key:recovery';
const RECOVERY_BYTES = 20;

/** Recovery secret key: 160 random bits shown as dash-separated base32 groups for the kit. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeSecretKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function decodeSecretKey(text: string): Uint8Array {
  const clean = text.replace(/[\s-]/g, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid secret key');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export interface AccountMaterial {
  kdfParams: KdfParams;
  salt: string;
  /** Sent to the server at signup/login. */
  authKey: string;
  wrappedAccountKey: string;
  wrappedRecoveryKey: string;
}

export interface CreatedAccount {
  material: AccountMaterial;
  accountKey: Uint8Array;
  /** Printable recovery secret; show once in the recovery kit. */
  recoverySecret: string;
}

const recoveryWrapKey = (secret: Uint8Array): Uint8Array => hkdfSha256(secret, 'recovery');

export async function createAccount(
  masterPassword: string,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<CreatedAccount> {
  const salt = randomBytes(16);
  const { authKey, kek } = deriveSubKeys(await deriveMasterKey(masterPassword, salt, kdfParams));
  const accountKey = newKey();
  const recovery = randomBytes(RECOVERY_BYTES);
  return {
    accountKey,
    recoverySecret: encodeSecretKey(recovery),
    material: {
      kdfParams,
      salt: toBase64Url(salt),
      authKey: toBase64Url(authKey),
      wrappedAccountKey: wrapKey(kek, accountKey, ACCOUNT_CTX),
      wrappedRecoveryKey: wrapKey(recoveryWrapKey(recovery), accountKey, RECOVERY_CTX),
    },
  };
}

/** Derive the auth key for login (before the server hands back wrapped keys). */
export async function deriveLogin(
  masterPassword: string,
  salt: string,
  kdfParams: KdfParams,
): Promise<{ authKey: string; kek: Uint8Array }> {
  const { authKey, kek } = deriveSubKeys(
    await deriveMasterKey(masterPassword, fromBase64Url(salt), kdfParams),
  );
  return { authKey: toBase64Url(authKey), kek };
}

export const unlockAccountKey = (kek: Uint8Array, wrappedAccountKey: string): Uint8Array =>
  unwrapKey(kek, wrappedAccountKey, ACCOUNT_CTX);

export function unlockWithRecovery(secret: string, wrappedRecoveryKey: string): Uint8Array {
  return unwrapKey(recoveryWrapKey(decodeSecretKey(secret)), wrappedRecoveryKey, RECOVERY_CTX);
}

/** Change master password: only the account key is re-wrapped; items are untouched. */
export async function changeMasterPassword(
  accountKey: Uint8Array,
  newPassword: string,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Pick<AccountMaterial, 'kdfParams' | 'salt' | 'authKey' | 'wrappedAccountKey'>> {
  const salt = randomBytes(16);
  const { authKey, kek } = deriveSubKeys(await deriveMasterKey(newPassword, salt, kdfParams));
  return {
    kdfParams,
    salt: toBase64Url(salt),
    authKey: toBase64Url(authKey),
    wrappedAccountKey: wrapKey(kek, accountKey, ACCOUNT_CTX),
  };
}
