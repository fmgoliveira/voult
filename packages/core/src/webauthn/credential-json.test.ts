import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { fromBase64Url } from '../crypto/bytes';
import { buildClientDataJSON, createPasskey, getAssertion } from './authenticator';
import {
  authenticationResponseJson,
  parseCreateRequest,
  parseGetRequest,
  registrationResponseJson,
} from './credential-json';

const RP_ID = 'example.com';
const ORIGIN = 'https://example.com';

describe('Credential Manager JSON', () => {
  it('parses create and get requests', () => {
    const c = parseCreateRequest(
      JSON.stringify({
        rp: { id: RP_ID, name: 'Example' },
        challenge: 'abc',
        user: { id: 'dXNlcg', name: 'alice', displayName: 'Alice' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        excludeCredentials: [{ type: 'public-key', id: 'x' }],
      }),
    );
    expect(c).toMatchObject({ rpId: RP_ID, algorithms: [-7], excludeCredentials: ['x'] });
    expect(
      parseGetRequest(
        JSON.stringify({ rpId: RP_ID, challenge: 'abc', allowCredentials: [{ id: 'y' }] }),
      ),
    ).toEqual({ rpId: RP_ID, challenge: 'abc', allowCredentials: ['y'] });
  });

  it('produces responses a relying party verifies (including the SPKI public key)', async () => {
    const opts = await generateRegistrationOptions({ rpName: 'E', rpID: RP_ID, userName: 'alice' });
    const created = createPasskey({
      rpId: RP_ID,
      userHandle: opts.user.id,
      userName: 'alice',
      clientDataJSON: buildClientDataJSON({
        type: 'webauthn.create',
        challenge: opts.challenge,
        origin: ORIGIN,
      }),
    });
    const reg = await verifyRegistrationResponse({
      response: JSON.parse(registrationResponseJson(created)),
      expectedChallenge: opts.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    expect(reg.verified).toBe(true);
    expect(
      fromBase64Url(JSON.parse(registrationResponseJson(created)).response.publicKey),
    ).toHaveLength(91);

    const auth = await generateAuthenticationOptions({ rpID: RP_ID });
    const cd = buildClientDataJSON({
      type: 'webauthn.get',
      challenge: auth.challenge,
      origin: ORIGIN,
    });
    // Browsers only hand over the hash of the client data.
    const assertion = getAssertion(created.passkey, new Uint8Array(), sha256(cd));
    const withHash = JSON.parse(authenticationResponseJson({ ...assertion, clientDataJSON: cd }));
    expect(fromBase64Url(withHash.response.clientDataJSON)).toEqual(cd);
    const ok = await verifyAuthenticationResponse({
      response: withHash,
      expectedChallenge: auth.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: created.passkey.credentialId,
        publicKey: reg.registrationInfo!.credential.publicKey,
        counter: 0,
      },
      requireUserVerification: true,
    });
    expect(ok.verified).toBe(true);
  });
});
