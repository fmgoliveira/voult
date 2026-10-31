import { requireNativeModule } from 'expo';
import type { Argon2idFn } from '@voult/core';
import { fromBase64Url, toBase64Url } from '@voult/core';

interface Native {
  argon2id(
    password: string,
    saltB64: string,
    memoryKiB: number,
    iterations: number,
    parallelism: number,
  ): Promise<string>;
  setSecureScreen(enabled: boolean): Promise<void>;
  copySensitive(text: string, clearAfterMs: number): void;
  clearClipboard(): void;
  isBiometricAvailable(): boolean;
  setAutofillIndex(json: string): Promise<void>;
  clearAutofillData(): void;
  takePendingSave(): string | null;
  autofillStatus(): { autofillEnabled: boolean; credentialProviderSupported: boolean };
  openAutofillSettings(): void;
  openCredentialProviderSettings(): void;
  getLaunchRequest(): Promise<string | null>;
  finishLaunch(result: string | null): void;
  keystoreHas(alias: string): boolean;
  keystoreDelete(alias: string): void;
  keystoreCreate(alias: string, requireBiometric: boolean): void;
  keystoreEncrypt(
    alias: string,
    plaintextB64: string,
    title: string,
    subtitle: string,
  ): Promise<{ ciphertext: string; iv: string }>;
  keystoreDecrypt(
    alias: string,
    ciphertextB64: string,
    ivB64: string,
    title: string,
    subtitle: string,
  ): Promise<string>;
}

const native = requireNativeModule<Native>('VoultNative');

/** Keystore aliases that start with this prefix require a fresh biometric authentication. */
export const BIOMETRIC_ALIAS = 'bio.voult.account';
/** Hardware-backed key (no prompt) that protects the on-device PIN blob. */
export const DEVICE_ALIAS = 'voult.device';

/** Plug into @voult/core so Argon2id runs natively (Hermes has no WebAssembly). */
export const nativeArgon2id: Argon2idFn = async (password, salt, params) =>
  fromBase64Url(await native.argon2id(password, toBase64Url(salt), params.m, params.t, params.p));

export const setSecureScreen = (enabled: boolean) => native.setSecureScreen(enabled);

/** Copy flagged as sensitive; auto-clears after `clearAfterSeconds` (0 = never). */
export const copySensitive = (text: string, clearAfterSeconds: number) =>
  native.copySensitive(text, Math.max(0, clearAfterSeconds) * 1000);
export const clearClipboard = () => native.clearClipboard();

export const isBiometricAvailable = () => native.isBiometricAvailable();

export interface Sealed {
  ciphertext: string;
  iv: string;
}

export class BiometricCanceledError extends Error {
  constructor() {
    super('biometric_canceled');
  }
}
export class KeyInvalidatedError extends Error {
  constructor() {
    super('key_invalidated');
  }
}

function translate(e: unknown): never {
  const code = (e as { code?: string })?.code;
  if (code === 'ERR_BIOMETRIC_CANCELED') throw new BiometricCanceledError();
  if (code === 'ERR_KEY_INVALIDATED') throw new KeyInvalidatedError();
  throw e;
}

/** Create the biometric-gated key and seal `secret` with it (prompts once). */
export async function biometricSeal(
  secret: Uint8Array,
  title: string,
  subtitle: string,
): Promise<Sealed> {
  native.keystoreCreate(BIOMETRIC_ALIAS, true);
  try {
    return await native.keystoreEncrypt(BIOMETRIC_ALIAS, toBase64Url(secret), title, subtitle);
  } catch (e) {
    native.keystoreDelete(BIOMETRIC_ALIAS);
    return translate(e);
  }
}

export async function biometricOpen(
  sealed: Sealed,
  title: string,
  subtitle: string,
): Promise<Uint8Array> {
  try {
    return fromBase64Url(
      await native.keystoreDecrypt(BIOMETRIC_ALIAS, sealed.ciphertext, sealed.iv, title, subtitle),
    );
  } catch (e) {
    return translate(e);
  }
}

export const biometricKeyExists = () => native.keystoreHas(BIOMETRIC_ALIAS);
export const biometricForget = () => native.keystoreDelete(BIOMETRIC_ALIAS);

/** Seal with the hardware-backed device key (no prompt). */
export async function deviceSeal(secret: Uint8Array): Promise<Sealed> {
  if (!native.keystoreHas(DEVICE_ALIAS)) native.keystoreCreate(DEVICE_ALIAS, false);
  return native.keystoreEncrypt(DEVICE_ALIAS, toBase64Url(secret), '', '');
}
export async function deviceOpen(sealed: Sealed): Promise<Uint8Array> {
  return fromBase64Url(
    await native.keystoreDecrypt(DEVICE_ALIAS, sealed.ciphertext, sealed.iv, '', ''),
  );
}

// ---------------------------------------------------------------------- autofill + passkeys

/** Hands the (secret-free) suggestion index to the autofill service and credential provider. */
export const setAutofillIndex = (json: string) => native.setAutofillIndex(json);
export const clearAutofillData = () => native.clearAutofillData();

export interface PendingSave {
  username: string;
  password: string;
  host: string | null;
  package: string | null;
}
/** A login the autofill save prompt captured in another app; returned once. */
export function takePendingSave(): PendingSave | null {
  const raw = native.takePendingSave();
  return raw ? (JSON.parse(raw) as PendingSave) : null;
}

export const autofillStatus = () => native.autofillStatus();
export const openAutofillSettings = () => native.openAutofillSettings();
export const openCredentialProviderSettings = () => native.openCredentialProviderSettings();

/** The request the system opened this screen for (autofill or Credential Manager), if any. */
export async function getLaunchRequest<T>(): Promise<T | null> {
  const raw = await native.getLaunchRequest();
  return raw ? (JSON.parse(raw) as T) : null;
}
/** Answer the request, or pass null to cancel; closes the screen. */
export const finishLaunch = (result: unknown | null) =>
  native.finishLaunch(result === null ? null : JSON.stringify(result));
