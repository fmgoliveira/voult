import {
  androidAppUrl,
  androidClientDataJSON,
  androidOrigin,
  authenticationResponseJson,
  baseDomain,
  buildClientDataJSON,
  createPasskey,
  fromBase64Url,
  getAssertion,
  isValidRpId,
  matchLogin,
  packageOfUrl,
  registrationResponseJson,
  type CreateRequestJson,
  type GetRequestJson,
  type ItemView,
  type LoginItem,
  type Passkey,
} from '@voult/core';

/** Autofill of a login into another app or website. */
export interface FillRequest {
  kind: 'fill';
  /** The form looks like a registration form, so offer to create a login. */
  signUp?: boolean;
  host: string | null;
  package: string | null;
  label: string | null;
  wantsUsername: boolean;
  wantsPassword: boolean;
}

/** A Credential Manager request, as gathered by CredentialActivity. */
export interface CredentialRequest {
  op: 'create' | 'get';
  type: 'passkey' | 'password';
  error?: string;
  requestJson?: string;
  /** base64url SHA-256 of the client data a browser built itself. */
  clientDataHash?: string;
  privileged?: boolean;
  origin?: string;
  certSha256?: string;
  verified?: boolean;
  callerPackage: string;
  callerLabel: string;
  itemId?: string;
  credentialId?: string;
  id?: string;
  password?: string;
}

export type LaunchRequest =
  ({ kind: 'fill' } & FillRequest) | ({ kind?: undefined } & CredentialRequest);

const logins = (items: ItemView[]) => items.filter((v) => !v.deletedAt && v.item.type === 'login');

/** Logins for the page/app being filled first (best matches), everything else after. */
export function loginsFor(
  items: ItemView[],
  req: Pick<FillRequest, 'host' | 'package'>,
): { matches: ItemView[]; others: ItemView[] } {
  const all = logins(items);
  const matches = all.filter((v) => {
    const login = v.item as LoginItem;
    if (req.host) return matchLogin(login, `https://${req.host}`);
    if (req.package) return login.urls.some((u) => packageOfUrl(u.url) === req.package);
    return false;
  });
  const set = new Set(matches.map((m) => m.id));
  const byTitle = (a: ItemView, b: ItemView) => a.item.title.localeCompare(b.item.title);
  return {
    matches: matches.sort(byTitle),
    others: all.filter((v) => !set.has(v.id)).sort(byTitle),
  };
}

/** Logins that look like they belong to a relying party (for attaching a new passkey). */
export function loginsForRp(items: ItemView[], rpId: string): ItemView[] {
  return logins(items).filter((v) => matchLogin(v.item as LoginItem, `https://${rpId}`));
}

export const fillValues = (item: LoginItem) => ({
  username: item.username || item.email,
  password: item.password,
});

/** Add the app to a login so it is suggested there next time. */
export const linkApp = (item: LoginItem, pkg: string): LoginItem['urls'] =>
  item.urls.some((u) => packageOfUrl(u.url) === pkg)
    ? item.urls
    : [...item.urls, { url: androidAppUrl(pkg), match: 'domain' }];

// ------------------------------------------------------------------ passkeys

export type Caller =
  | {
      ok: true;
      origin: string;
      /** Set for browsers: they hash the client data themselves. */
      hash?: Uint8Array;
      clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string): Uint8Array;
    }
  | { ok: false; reason: string };

/** Works out who is asking and whether they may use this relying party. */
export function resolveCaller(req: CredentialRequest, rpId: string): Caller {
  if (!rpId) return { ok: false, reason: 'The request has no relying party.' };
  if (req.privileged && req.origin) {
    let host = '';
    try {
      host = new URL(req.origin).hostname;
    } catch {
      /* invalid */
    }
    const origin = req.origin;
    if (!host || !isValidRpId(rpId, host)) {
      return { ok: false, reason: `${host || 'This site'} cannot use passkeys for ${rpId}.` };
    }
    return {
      ok: true,
      origin,
      hash: req.clientDataHash ? fromBase64Url(req.clientDataHash) : undefined,
      clientData: (type, challenge) => buildClientDataJSON({ type, challenge, origin }),
    };
  }
  if (!req.verified || !req.certSha256) {
    return {
      ok: false,
      reason: `${req.callerLabel} is not linked to ${rpId}, so it cannot use its passkeys.`,
    };
  }
  const origin = androidOrigin(fromBase64Url(req.certSha256));
  return {
    ok: true,
    origin,
    clientData: (type, challenge) =>
      androidClientDataJSON({ type, challenge, origin, packageName: req.callerPackage }),
  };
}

export function createResponse(
  request: CreateRequestJson,
  caller: Extract<Caller, { ok: true }>,
  now = Date.now(),
) {
  const created = createPasskey({
    rpId: request.rpId,
    rpName: request.rpName,
    userHandle: request.user.id,
    userName: request.user.name,
    clientDataJSON: caller.clientData('webauthn.create', request.challenge),
    now,
  });
  return { passkey: created.passkey, response: registrationResponseJson(created, !caller.hash) };
}

export function getResponse(
  passkey: Passkey,
  request: GetRequestJson,
  caller: Extract<Caller, { ok: true }>,
) {
  const clientDataJSON = caller.clientData('webauthn.get', request.challenge);
  const assertion = getAssertion(passkey, clientDataJSON, caller.hash);
  return {
    updated: assertion.updated,
    response: authenticationResponseJson(assertion, !caller.hash),
  };
}

/** Whether `rpId` shares a registrable domain with a stored login's site (for the title/URL). */
export const rpDomain = (rpId: string) => baseDomain(rpId);
