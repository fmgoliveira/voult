import { defineContentScript } from 'wxt/utils/define-content-script';
import type {
  PasskeyCreateResult,
  PasskeyGetResult,
  PasskeyResponse,
} from '../lib/autofill/messages';

/**
 * MAIN-world hook for navigator.credentials. It only serialises the request and hands it to the
 * extension; if the extension declines (locked, unsupported, opted out, user chose the browser)
 * the original browser implementation runs untouched.
 */
export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  allFrames: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const proto = globalThis.CredentialsContainer?.prototype;
    if (!proto || !globalThis.PublicKeyCredential) return;
    const origCreate = proto.create;
    const origGet = proto.get;

    const toB64 = (buf: BufferSource): string => {
      const bytes =
        buf instanceof ArrayBuffer
          ? new Uint8Array(buf)
          : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const fromB64 = (s: string): ArrayBuffer => {
      const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    };

    function ask<T>(msg: unknown): Promise<PasskeyResponse<T>> {
      return new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => {
          ch.port1.close();
          resolve(e.data as PasskeyResponse<T>);
        };
        postMessage({ __voult: 'passkey', msg }, '*', [ch.port2]);
      });
    }

    const define = (target: object, props: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(props)) {
        Object.defineProperty(target, k, {
          value: v,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return target;
    };

    function buildCreated(r: PasskeyCreateResult): Credential {
      const response = define(Object.create(AuthenticatorAttestationResponse.prototype), {
        clientDataJSON: fromB64(r.clientDataJSON),
        attestationObject: fromB64(r.attestationObject),
        getTransports: () => ['internal', 'hybrid'],
        getAuthenticatorData: () => fromB64(r.authenticatorData),
        getPublicKey: () => fromB64(r.publicKey),
        getPublicKeyAlgorithm: () => -7,
      });
      return define(Object.create(PublicKeyCredential.prototype), {
        id: r.id,
        rawId: fromB64(r.id),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response,
        getClientExtensionResults: () => ({}),
        toJSON: () => ({
          id: r.id,
          rawId: r.id,
          type: 'public-key',
          authenticatorAttachment: 'platform',
          response: {
            clientDataJSON: r.clientDataJSON,
            attestationObject: r.attestationObject,
            transports: ['internal', 'hybrid'],
            publicKeyAlgorithm: -7,
            publicKey: r.publicKey,
            authenticatorData: r.authenticatorData,
          },
          clientExtensionResults: {},
        }),
      }) as Credential;
    }

    function buildAsserted(r: PasskeyGetResult): Credential {
      const response = define(Object.create(AuthenticatorAssertionResponse.prototype), {
        clientDataJSON: fromB64(r.clientDataJSON),
        authenticatorData: fromB64(r.authenticatorData),
        signature: fromB64(r.signature),
        userHandle: r.userHandle ? fromB64(r.userHandle) : null,
      });
      return define(Object.create(PublicKeyCredential.prototype), {
        id: r.id,
        rawId: fromB64(r.id),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response,
        getClientExtensionResults: () => ({}),
        toJSON: () => ({
          id: r.id,
          rawId: r.id,
          type: 'public-key',
          authenticatorAttachment: 'platform',
          response: {
            clientDataJSON: r.clientDataJSON,
            authenticatorData: r.authenticatorData,
            signature: r.signature,
            userHandle: r.userHandle,
          },
          clientExtensionResults: {},
        }),
      }) as Credential;
    }

    const idList = (list?: PublicKeyCredentialDescriptor[]) => (list ?? []).map((c) => toB64(c.id));

    proto.create = async function (
      this: CredentialsContainer,
      options?: CredentialCreationOptions,
    ) {
      const pk = options?.publicKey;
      if (!pk || options?.signal?.aborted) return origCreate.call(this, options);
      const res = await ask<PasskeyCreateResult>({
        type: 'passkey:create',
        options: {
          rpId: pk.rp.id ?? location.hostname,
          rpName: pk.rp.name,
          challenge: toB64(pk.challenge),
          user: { id: toB64(pk.user.id), name: pk.user.name, displayName: pk.user.displayName },
          pubKeyCredParams: pk.pubKeyCredParams.map((p) => ({ type: p.type, alg: p.alg })),
          excludeCredentials: idList(pk.excludeCredentials),
        },
      });
      if (res.status === 'ok') return buildCreated(res.result);
      if (res.status === 'error')
        throw new DOMException(
          res.name === 'InvalidStateError'
            ? 'The authenticator was previously registered'
            : 'The operation was not allowed',
          res.name,
        );
      return origCreate.call(this, options);
    };

    proto.get = async function (this: CredentialsContainer, options?: CredentialRequestOptions) {
      const pk = options?.publicKey;
      // Conditional UI (autofill-style sign-in) stays with the browser.
      if (!pk || options?.signal?.aborted || options?.mediation === 'conditional')
        return origGet.call(this, options);
      const res = await ask<PasskeyGetResult>({
        type: 'passkey:get',
        options: {
          rpId: pk.rpId ?? location.hostname,
          challenge: toB64(pk.challenge),
          allowCredentials: idList(pk.allowCredentials),
        },
      });
      if (res.status === 'ok') return buildAsserted(res.result);
      if (res.status === 'error') throw new DOMException('The operation was not allowed', res.name);
      return origGet.call(this, options);
    };
  },
});
