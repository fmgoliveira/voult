import {
  androidAppUrl,
  blankItem,
  parseCreateRequest,
  parseGetRequest,
  toBase64Url,
  type ItemView,
  type LoginItem,
} from '@voult/core';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import {
  createResponse,
  getResponse,
  linkApp,
  loginsFor,
  resolveCaller,
  type CredentialRequest,
} from '../src/autofill/flows';

const view = (id: string, patch: Partial<LoginItem>): ItemView => ({
  id,
  vaultId: 'v',
  item: { ...(blankItem('login') as LoginItem), title: id, ...patch },
  deletedAt: null,
  dirty: false,
});

describe('loginsFor', () => {
  const items = [
    view('github', { urls: [{ url: 'https://github.com', match: 'domain' }] }),
    view('bank-app', { urls: [{ url: androidAppUrl('com.bank'), match: 'domain' }] }),
    view('other', { urls: [{ url: 'https://example.org', match: 'domain' }] }),
  ];
  it('puts web matches first and ignores http', () => {
    expect(
      loginsFor(items, { host: 'gist.github.com', package: null }).matches.map((v) => v.id),
    ).toEqual(['github']);
  });
  it('matches linked apps by package', () => {
    const r = loginsFor(items, { host: null, package: 'com.bank' });
    expect(r.matches.map((v) => v.id)).toEqual(['bank-app']);
    expect(r.others).toHaveLength(2);
  });
  it('links an app once', () => {
    const login = items[2]!.item as LoginItem;
    const urls = linkApp(login, 'com.x');
    expect(urls).toHaveLength(2);
    expect(linkApp({ ...login, urls }, 'com.x')).toHaveLength(2);
  });
});

describe('Credential Manager passkeys', () => {
  const RP = 'example.com';
  const ORIGIN = 'https://example.com';

  it('rejects a browser origin that does not own the rpId', () => {
    const r = resolveCaller(
      {
        op: 'create',
        type: 'passkey',
        privileged: true,
        origin: 'https://evil.com',
        callerPackage: 'p',
        callerLabel: 'Chrome',
      },
      RP,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a native app that is not verified', () => {
    const r = resolveCaller(
      {
        op: 'get',
        type: 'passkey',
        privileged: false,
        verified: false,
        callerPackage: 'p',
        callerLabel: 'App',
      },
      RP,
    );
    expect(r.ok).toBe(false);
  });

  it('registers and signs in for a native app (client data built here)', async () => {
    const cert = sha256(new Uint8Array([1, 2, 3]));
    const req: CredentialRequest = {
      op: 'create',
      type: 'passkey',
      verified: true,
      certSha256: toBase64Url(cert),
      callerPackage: 'com.example.app',
      callerLabel: 'App',
    };
    const caller = resolveCaller(req, RP);
    if (!caller.ok) throw new Error('caller');
    const origin = caller.origin;
    expect(origin).toBe(`android:apk-key-hash:${toBase64Url(cert)}`);

    const opts = await generateRegistrationOptions({ rpName: 'E', rpID: RP, userName: 'alice' });
    const parsed = parseCreateRequest(
      JSON.stringify({
        rp: { id: RP, name: 'E' },
        challenge: opts.challenge,
        user: { id: opts.user.id, name: 'alice', displayName: 'Alice' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      }),
    );
    const created = createResponse(parsed, caller);
    const reg = await verifyRegistrationResponse({
      response: JSON.parse(created.response),
      expectedChallenge: opts.challenge,
      expectedOrigin: origin,
      expectedRPID: RP,
      requireUserVerification: true,
    });
    expect(reg.verified).toBe(true);

    const auth = await generateAuthenticationOptions({ rpID: RP });
    const got = getResponse(
      created.passkey,
      parseGetRequest(JSON.stringify({ rpId: RP, challenge: auth.challenge })),
      caller,
    );
    const ok = await verifyAuthenticationResponse({
      response: JSON.parse(got.response),
      expectedChallenge: auth.challenge,
      expectedOrigin: origin,
      expectedRPID: RP,
      credential: {
        id: created.passkey.credentialId,
        publicKey: reg.registrationInfo!.credential.publicKey,
        counter: 0,
      },
      requireUserVerification: true,
    });
    expect(ok.verified).toBe(true);
    expect(got.updated.signCount).toBe(1);
  });

  it('signs over the hash a browser supplies', async () => {
    const opts = await generateRegistrationOptions({ rpName: 'E', rpID: RP, userName: 'alice' });
    const clientData = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge: 'c', origin: ORIGIN }),
    );
    const caller = resolveCaller(
      {
        op: 'get',
        type: 'passkey',
        privileged: true,
        origin: ORIGIN,
        clientDataHash: toBase64Url(sha256(clientData)),
        callerPackage: 'com.android.chrome',
        callerLabel: 'Chrome',
      },
      RP,
    );
    if (!caller.ok) throw new Error('caller');
    expect(caller.hash).toBeDefined();
    const created = createResponse(
      parseCreateRequest(
        JSON.stringify({
          rp: { id: RP, name: 'E' },
          challenge: 'c',
          user: { id: opts.user.id, name: 'alice', displayName: '' },
        }),
      ),
      caller,
    );
    expect(JSON.parse(created.response).response.clientDataJSON).toBe('');
  });
});
