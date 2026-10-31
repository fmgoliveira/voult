import { toBase64Url, utf8 } from '../crypto/bytes';
import type { AssertionResult, CreateResult } from './authenticator';

/**
 * JSON shapes used by Android's Credential Manager (the WebAuthn "JSON" encodings), so the Kotlin
 * credential provider only moves strings and the passkey logic stays in TypeScript.
 */

export interface CreateRequestJson {
  rpId: string;
  rpName: string;
  challenge: string;
  user: { id: string; name: string; displayName: string };
  /** COSE algorithm ids the site accepts; empty means "any". */
  algorithms: number[];
  excludeCredentials: string[];
}

export interface GetRequestJson {
  rpId: string;
  challenge: string;
  allowCredentials: string[];
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((c) => str(obj(c).id)).filter(Boolean) : [];

export function parseCreateRequest(json: string): CreateRequestJson {
  const j = obj(JSON.parse(json));
  const user = obj(j.user);
  const rp = obj(j.rp);
  const params = Array.isArray(j.pubKeyCredParams) ? j.pubKeyCredParams : [];
  return {
    rpId: str(rp.id),
    rpName: str(rp.name),
    challenge: str(j.challenge),
    user: { id: str(user.id), name: str(user.name), displayName: str(user.displayName) },
    algorithms: params.map((p) => obj(p).alg).filter((a): a is number => typeof a === 'number'),
    excludeCredentials: ids(j.excludeCredentials),
  };
}

export function parseGetRequest(json: string): GetRequestJson {
  const j = obj(JSON.parse(json));
  return {
    rpId: str(j.rpId),
    challenge: str(j.challenge),
    allowCredentials: ids(j.allowCredentials),
  };
}

/** What a native (non-browser) app is identified by in `clientDataJSON.origin`. */
export const androidOrigin = (certSha256: Uint8Array): string =>
  `android:apk-key-hash:${toBase64Url(certSha256)}`;

/** Client data for a caller that is not a privileged browser (the platform gives us no hash). */
export function androidClientDataJSON(o: {
  type: 'webauthn.create' | 'webauthn.get';
  challenge: string;
  origin: string;
  packageName: string;
}): Uint8Array {
  return utf8(
    JSON.stringify({
      type: o.type,
      challenge: o.challenge,
      origin: o.origin,
      androidPackageName: o.packageName,
    }),
  );
}

export function registrationResponseJson(created: CreateResult, clientDataKnown = true): string {
  const id = created.passkey.credentialId;
  return JSON.stringify({
    id,
    rawId: id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      // Browsers build and hash the client data themselves and ignore this field.
      clientDataJSON: clientDataKnown ? toBase64Url(created.clientDataJSON) : '',
      attestationObject: toBase64Url(created.attestationObject),
      transports: ['internal', 'hybrid'],
      authenticatorData: toBase64Url(created.authData),
      publicKeyAlgorithm: -7,
      publicKey: toBase64Url(created.publicKeySpki),
    },
    clientExtensionResults: {},
  });
}

export function authenticationResponseJson(a: AssertionResult, clientDataKnown = true): string {
  const id = toBase64Url(a.credentialId);
  return JSON.stringify({
    id,
    rawId: id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: clientDataKnown ? toBase64Url(a.clientDataJSON) : '',
      authenticatorData: toBase64Url(a.authData),
      signature: toBase64Url(a.signature),
      userHandle: toBase64Url(a.userHandle),
    },
    clientExtensionResults: {},
  });
}
