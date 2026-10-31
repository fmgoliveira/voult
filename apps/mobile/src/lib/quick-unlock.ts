import {
  DEFAULT_KDF_PARAMS,
  deriveMasterKey,
  fromBase64Url,
  fromUtf8,
  hkdfSha256,
  randomBytes,
  toBase64Url,
  unwrapKey,
  utf8,
  wrapKey,
} from '@voult/core';

/** The native Keystore surface we depend on (faked in tests). */
export interface KeystoreApi {
  isBiometricAvailable(): boolean;
  biometricSeal(secret: Uint8Array, title: string, subtitle: string): Promise<Sealed>;
  biometricOpen(sealed: Sealed, title: string, subtitle: string): Promise<Uint8Array>;
  biometricForget(): void;
  deviceSeal(secret: Uint8Array): Promise<Sealed>;
  deviceOpen(sealed: Sealed): Promise<Uint8Array>;
}

export interface Sealed {
  ciphertext: string;
  iv: string;
}

/** Small persistent key/value store (expo-secure-store on device). */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const PIN_MAX_ATTEMPTS = 5;
const BIO_KEY = 'voult.bio';
const PIN_KEY = 'voult.pin';
const PIN_CONTEXT = 'voult:pin';

interface PinRecord {
  salt: string;
  /** Account key wrapped by Argon2id(PIN), then sealed with the hardware-backed device key. */
  sealed: Sealed;
  attemptsLeft: number;
}

export class BiometricUnavailableError extends Error {
  constructor() {
    super('biometric_unavailable');
  }
}

/**
 * Quick unlock for Android:
 *  - Biometric: the account key is sealed by a Keystore key that needs a fresh strong-biometric
 *    authentication for every use and dies if biometrics are re-enrolled.
 *  - PIN: the account key is wrapped by Argon2id(PIN) and sealed again by a hardware-backed
 *    device key, so a copied app database alone gives an attacker nothing to brute-force.
 *    Five wrong attempts destroy it.
 */
export function createQuickUnlock(keystore: KeystoreApi, kv: KeyValue) {
  const pinKey = async (pin: string, salt: Uint8Array) =>
    hkdfSha256(await deriveMasterKey(pin, salt, DEFAULT_KDF_PARAMS), 'pin');

  async function readPin(): Promise<PinRecord | null> {
    const raw = await kv.get(PIN_KEY);
    return raw ? (JSON.parse(raw) as PinRecord) : null;
  }

  return {
    biometricAvailable: () => keystore.isBiometricAvailable(),
    hasBiometric: async () => (await kv.get(BIO_KEY)) !== null,
    hasPin: async () => (await readPin()) !== null,

    async enableBiometric(accountKey: Uint8Array): Promise<void> {
      if (!keystore.isBiometricAvailable()) throw new BiometricUnavailableError();
      const sealed = await keystore.biometricSeal(
        accountKey,
        'Enable biometric unlock',
        'Confirm it is you',
      );
      await kv.set(BIO_KEY, JSON.stringify(sealed));
    },

    /** Prompts for biometrics. Throws BiometricCanceledError / KeyInvalidatedError from the native layer. */
    async unlockWithBiometric(): Promise<Uint8Array> {
      const raw = await kv.get(BIO_KEY);
      if (!raw) throw new BiometricUnavailableError();
      try {
        return await keystore.biometricOpen(
          JSON.parse(raw) as Sealed,
          'Unlock Voult',
          'Confirm it is you',
        );
      } catch (e) {
        if ((e as Error).message === 'key_invalidated') {
          keystore.biometricForget();
          await kv.remove(BIO_KEY);
        }
        throw e;
      }
    },

    async disableBiometric(): Promise<void> {
      keystore.biometricForget();
      await kv.remove(BIO_KEY);
    },

    async setPin(pin: string, accountKey: Uint8Array): Promise<void> {
      const salt = randomBytes(16);
      const wrapped = wrapKey(await pinKey(pin, salt), accountKey, PIN_CONTEXT);
      const sealed = await keystore.deviceSeal(utf8(wrapped));
      const rec: PinRecord = { salt: toBase64Url(salt), sealed, attemptsLeft: PIN_MAX_ATTEMPTS };
      await kv.set(PIN_KEY, JSON.stringify(rec));
    },

    async unlockWithPin(
      pin: string,
    ): Promise<{ ok: true; accountKey: Uint8Array } | { ok: false; attemptsLeft: number }> {
      const rec = await readPin();
      if (!rec) return { ok: false, attemptsLeft: 0 };
      try {
        const wrapped = fromUtf8(await keystore.deviceOpen(rec.sealed));
        const key = unwrapKey(await pinKey(pin, fromBase64Url(rec.salt)), wrapped, PIN_CONTEXT);
        await kv.set(PIN_KEY, JSON.stringify({ ...rec, attemptsLeft: PIN_MAX_ATTEMPTS }));
        return { ok: true, accountKey: key };
      } catch {
        const attemptsLeft = rec.attemptsLeft - 1;
        if (attemptsLeft <= 0) await kv.remove(PIN_KEY);
        else await kv.set(PIN_KEY, JSON.stringify({ ...rec, attemptsLeft }));
        return { ok: false, attemptsLeft: Math.max(attemptsLeft, 0) };
      }
    },

    async disablePin(): Promise<void> {
      await kv.remove(PIN_KEY);
    },

    async clearAll(): Promise<void> {
      keystore.biometricForget();
      await kv.remove(BIO_KEY);
      await kv.remove(PIN_KEY);
    },
  };
}

export type QuickUnlock = ReturnType<typeof createQuickUnlock>;
