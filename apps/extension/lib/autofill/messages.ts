/**
 * Content-script <-> background protocol. Secrets only ever travel in the *response* to a
 * request the user triggered from that exact frame (NFR4); the background re-checks the
 * frame's real URL (from `sender`, never from the message) before releasing anything.
 */

export interface MatchSummary {
  id: string;
  title: string;
  username: string;
  hasTotp: boolean;
}

export type QueryResponse =
  | { status: 'ok'; matches: MatchSummary[] }
  | { status: 'locked' }
  | { status: 'none' }
  | { status: 'disabled' };

export interface FillSecrets {
  username: string;
  password: string;
  totp: string | null;
}

export type ContentRequest =
  | { type: 'autofill:query' }
  | { type: 'autofill:fill'; id: string }
  | { type: 'autofill:otp' }
  | { type: 'autofill:generate' }
  | { type: 'capture:submit'; username: string; password: string; isNewPassword: boolean }
  | { type: 'capture:poll' }
  | { type: 'capture:accept' }
  | { type: 'capture:dismiss'; never: boolean }
  | { type: 'passkey:create'; options: PasskeyCreateOptions }
  | { type: 'passkey:get'; options: PasskeyGetOptions };

/** Background -> content script (sent to a specific tab/frame). */
export type BackgroundCommand = { type: 'autofill:trigger' } | { type: 'autofill:generate-here' };

export interface CapturePrompt {
  action: 'save' | 'update';
  host: string;
  username: string;
  title: string;
}

// ---- passkeys (serialised WebAuthn options; binary values are base64url strings)

export interface PasskeyCreateOptions {
  rpId: string;
  rpName: string;
  challenge: string;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: string; alg: number }[];
  excludeCredentials: string[];
}

export interface PasskeyGetOptions {
  rpId: string;
  challenge: string;
  allowCredentials: string[];
}

export interface PasskeyCreateResult {
  id: string;
  attestationObject: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
}

export interface PasskeyGetResult {
  id: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  userHandle: string;
}

export type PasskeyResponse<T> =
  | { status: 'ok'; result: T }
  | { status: 'fallback' }
  | { status: 'error'; name: 'NotAllowedError' | 'InvalidStateError' | 'SecurityError' };
