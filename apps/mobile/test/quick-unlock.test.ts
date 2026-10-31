import {
  fromBase64Url,
  open,
  randomBytes,
  seal,
  setArgon2Implementation,
  toBase64Url,
} from '@voult/core';
import { argon2id } from 'hash-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BiometricUnavailableError,
  createQuickUnlock,
  PIN_MAX_ATTEMPTS,
  type KeystoreApi,
  type KeyValue,
  type Sealed,
} from '../src/lib/quick-unlock';

beforeAll(() =>
  setArgon2Implementation(async (password, salt) =>
    argon2id({
      password,
      salt,
      memorySize: 64,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      outputType: 'binary',
    }),
  ),
);
afterAll(() => setArgon2Implementation(null));

/** Software stand-in for the Android Keystore: a key that never leaves this object. */
function fakeKeystore(opts: { biometrics?: boolean } = {}) {
  const bioKey = randomBytes(32);
  const deviceKey = randomBytes(32);
  let bioExists = false;
  let invalidated = false;
  let prompts = 0;
  const wrap = (key: Uint8Array, secret: Uint8Array): Sealed => ({
    ciphertext: toBase64Url(seal(key, secret, 'ks')),
    iv: 'x',
  });
  const unwrap = (key: Uint8Array, s: Sealed) => open(key, fromBase64Url(s.ciphertext), 'ks');
  const api: KeystoreApi = {
    isBiometricAvailable: () => opts.biometrics ?? true,
    biometricSeal: async (secret) => {
      bioExists = true;
      return wrap(bioKey, secret);
    },
    biometricOpen: async (sealed) => {
      prompts++;
      if (invalidated) throw new Error('key_invalidated');
      return unwrap(bioKey, sealed);
    },
    biometricForget: () => void (bioExists = false),
    deviceSeal: async (secret) => wrap(deviceKey, secret),
    deviceOpen: async (sealed) => unwrap(deviceKey, sealed),
  };
  return {
    api,
    invalidate: () => void (invalidated = true),
    get bioExists() {
      return bioExists;
    },
    get prompts() {
      return prompts;
    },
  };
}

function memoryKv(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

const accountKey = randomBytes(32);

describe('PIN quick unlock', () => {
  it('unlocks with the right PIN and keeps nothing readable in storage', async () => {
    const kv = memoryKv();
    const q = createQuickUnlock(fakeKeystore().api, kv);
    expect(await q.hasPin()).toBe(false);
    await q.setPin('4821', accountKey);
    expect(await q.hasPin()).toBe(true);

    const stored = [...kv.data.values()].join('');
    expect(stored).not.toContain(toBase64Url(accountKey));

    const r = await q.unlockWithPin('4821');
    expect(r.ok && r.accountKey).toEqual(accountKey);
  });

  it('counts down wrong attempts, resets on success, and wipes after five failures', async () => {
    const q = createQuickUnlock(fakeKeystore().api, memoryKv());
    await q.setPin('1234', accountKey);

    expect(await q.unlockWithPin('0000')).toEqual({
      ok: false,
      attemptsLeft: PIN_MAX_ATTEMPTS - 1,
    });
    expect(await q.unlockWithPin('0001')).toEqual({
      ok: false,
      attemptsLeft: PIN_MAX_ATTEMPTS - 2,
    });
    expect((await q.unlockWithPin('1234')).ok).toBe(true); // success resets the counter
    expect(await q.unlockWithPin('9')).toEqual({ ok: false, attemptsLeft: PIN_MAX_ATTEMPTS - 1 });

    for (let i = 0; i < PIN_MAX_ATTEMPTS - 2; i++) await q.unlockWithPin('9');
    expect(await q.unlockWithPin('9')).toEqual({ ok: false, attemptsLeft: 0 });
    expect(await q.hasPin()).toBe(false);
    // Even the correct PIN no longer works: the user must use the master password.
    expect(await q.unlockWithPin('1234')).toEqual({ ok: false, attemptsLeft: 0 });
  });

  it('fails when the hardware key is gone (e.g. restored app data on another phone)', async () => {
    const kv = memoryKv();
    await createQuickUnlock(fakeKeystore().api, kv).setPin('1234', accountKey);
    const otherPhone = createQuickUnlock(fakeKeystore().api, kv);
    expect((await otherPhone.unlockWithPin('1234')).ok).toBe(false);
  });

  it('can be disabled', async () => {
    const q = createQuickUnlock(fakeKeystore().api, memoryKv());
    await q.setPin('1234', accountKey);
    await q.disablePin();
    expect(await q.hasPin()).toBe(false);
  });
});

describe('biometric quick unlock', () => {
  it('seals the key behind the biometric prompt and opens it again', async () => {
    const ks = fakeKeystore();
    const q = createQuickUnlock(ks.api, memoryKv());
    expect(await q.hasBiometric()).toBe(false);
    await q.enableBiometric(accountKey);
    expect(await q.hasBiometric()).toBe(true);
    expect(await q.unlockWithBiometric()).toEqual(accountKey);
    expect(ks.prompts).toBe(1);
  });

  it('refuses to enable without biometric hardware, and when nothing is enrolled', async () => {
    const q = createQuickUnlock(fakeKeystore({ biometrics: false }).api, memoryKv());
    expect(q.biometricAvailable()).toBe(false);
    await expect(q.enableBiometric(accountKey)).rejects.toBeInstanceOf(BiometricUnavailableError);
    await expect(q.unlockWithBiometric()).rejects.toBeInstanceOf(BiometricUnavailableError);
  });

  it('forgets the key when biometrics were re-enrolled', async () => {
    const ks = fakeKeystore();
    const q = createQuickUnlock(ks.api, memoryKv());
    await q.enableBiometric(accountKey);
    ks.invalidate();
    await expect(q.unlockWithBiometric()).rejects.toThrow('key_invalidated');
    expect(await q.hasBiometric()).toBe(false);
    expect(ks.bioExists).toBe(false);
  });

  it('clearAll removes both methods', async () => {
    const ks = fakeKeystore();
    const q = createQuickUnlock(ks.api, memoryKv());
    await q.enableBiometric(accountKey);
    await q.setPin('1234', accountKey);
    await q.clearAll();
    expect(await q.hasBiometric()).toBe(false);
    expect(await q.hasPin()).toBe(false);
    await q.enableBiometric(accountKey);
    await q.disableBiometric();
    expect(await q.hasBiometric()).toBe(false);
  });
});
