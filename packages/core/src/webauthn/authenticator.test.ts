import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';
import { toBase64Url } from '../crypto/bytes';
import {
  buildClientDataJSON,
  createPasskey,
  getAssertion,
  isValidRpId,
  matchPasskeys,
} from './authenticator';

const RP_ID = 'example.com';
const ORIGIN = 'https://example.com';

describe('software authenticator interops with @simplewebauthn/server', () => {
  it('registers, then signs in repeatedly with an advancing counter', async () => {
    const regOpts = await generateRegistrationOptions({
      rpName: 'Example',
      rpID: RP_ID,
      userName: 'alice',
      attestationType: 'none',
    });
    const created = createPasskey({
      rpId: RP_ID,
      rpName: 'Example',
      userHandle: regOpts.user.id,
      userName: 'alice',
      clientDataJSON: buildClientDataJSON({
        type: 'webauthn.create',
        challenge: regOpts.challenge,
        origin: ORIGIN,
      }),
    });

    const reg = await verifyRegistrationResponse({
      response: {
        id: created.passkey.credentialId,
        rawId: created.passkey.credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(created.clientDataJSON),
          attestationObject: toBase64Url(created.attestationObject),
          transports: ['internal'],
        },
      },
      expectedChallenge: regOpts.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    expect(reg.verified).toBe(true);
    const info = reg.registrationInfo!;
    expect(info.credential.id).toBe(created.passkey.credentialId);
    expect(info.credentialDeviceType).toBe('multiDevice');
    expect(info.credentialBackedUp).toBe(true);

    let passkey = created.passkey;
    let counter = info.credential.counter;
    for (let i = 1; i <= 3; i++) {
      const authOpts = await generateAuthenticationOptions({ rpID: RP_ID });
      const assertion = getAssertion(
        passkey,
        buildClientDataJSON({
          type: 'webauthn.get',
          challenge: authOpts.challenge,
          origin: ORIGIN,
        }),
      );
      const auth = await verifyAuthenticationResponse({
        response: {
          id: passkey.credentialId,
          rawId: passkey.credentialId,
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            authenticatorData: toBase64Url(assertion.authData),
            clientDataJSON: toBase64Url(assertion.clientDataJSON),
            signature: toBase64Url(assertion.signature),
            userHandle: toBase64Url(assertion.userHandle),
          },
        },
        expectedChallenge: authOpts.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: passkey.credentialId,
          publicKey: info.credential.publicKey,
          counter,
        },
        requireUserVerification: true,
      });
      expect(auth.verified).toBe(true);
      expect(auth.authenticationInfo.newCounter).toBe(i);
      counter = auth.authenticationInfo.newCounter;
      passkey = assertion.updated;
    }
    expect(passkey.signCount).toBe(3);
  });

  it('assertions for a different challenge do not verify', async () => {
    const created = createPasskey({
      rpId: RP_ID,
      userHandle: toBase64Url(new Uint8Array([1, 2, 3])),
      clientDataJSON: buildClientDataJSON({
        type: 'webauthn.create',
        challenge: 'abc',
        origin: ORIGIN,
      }),
    });
    const reg = await verifyRegistrationResponse({
      response: {
        id: created.passkey.credentialId,
        rawId: created.passkey.credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(created.clientDataJSON),
          attestationObject: toBase64Url(created.attestationObject),
        },
      },
      expectedChallenge: 'abc',
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    const a = getAssertion(
      created.passkey,
      buildClientDataJSON({ type: 'webauthn.get', challenge: 'other', origin: ORIGIN }),
    );
    await expect(
      verifyAuthenticationResponse({
        response: {
          id: created.passkey.credentialId,
          rawId: created.passkey.credentialId,
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            authenticatorData: toBase64Url(a.authData),
            clientDataJSON: toBase64Url(a.clientDataJSON),
            signature: toBase64Url(a.signature),
          },
        },
        expectedChallenge: 'expected',
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: created.passkey.credentialId,
          publicKey: reg.registrationInfo!.credential.publicKey,
          counter: 0,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('helpers', () => {
  const mk = (id: string, rpId: string) => ({
    credentialId: id,
    rpId,
    rpName: '',
    userHandle: 'u',
    userName: '',
    privateKey: 'k',
    signCount: 0,
    createdAt: 1,
  });
  it('matchPasskeys filters by rpId and allow list', () => {
    const list = [mk('a', 'x.com'), mk('b', 'x.com'), mk('c', 'y.com')];
    expect(matchPasskeys(list, 'x.com').map((k) => k.credentialId)).toEqual(['a', 'b']);
    expect(matchPasskeys(list, 'x.com', ['b']).map((k) => k.credentialId)).toEqual(['b']);
    expect(matchPasskeys(list, 'x.com', []).length).toBe(2);
  });
  it('isValidRpId allows host or parent domain only', () => {
    expect(isValidRpId('example.com', 'example.com')).toBe(true);
    expect(isValidRpId('example.com', 'login.Example.com')).toBe(true);
    expect(isValidRpId('login.example.com', 'example.com')).toBe(false);
    expect(isValidRpId('evilexample.com', 'example.com')).toBe(false);
    expect(isValidRpId('example.com/x', 'example.com')).toBe(false);
    expect(isValidRpId('', 'example.com')).toBe(false);
  });
});

import { cborEncode } from './cbor';

describe('cborEncode', () => {
  it('encodes ints, text, bytes and maps per RFC 8949', () => {
    const hex = (v: Parameters<typeof cborEncode>[0]) =>
      Array.from(cborEncode(v), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex(0)).toBe('00');
    expect(hex(23)).toBe('17');
    expect(hex(24)).toBe('1818');
    expect(hex(255)).toBe('18ff');
    expect(hex(256)).toBe('190100');
    expect(hex(65536)).toBe('1a00010000');
    expect(hex(-1)).toBe('20');
    expect(hex(-7)).toBe('26');
    expect(hex('IETF')).toBe('6449455446');
    expect(hex(new Uint8Array([1, 2]))).toBe('420102');
    expect(hex(new Map([[1, 2]]))).toBe('a10102');
  });
});
