import { baseDomain, hostnameOf } from '../matching/url';
import type { LoginItem } from '../vault/schemas';
import { identifierOf } from './identity';
import type { ItemView } from './types';

/**
 * What the Android autofill service and credential provider need to offer suggestions while the
 * app is not running. Kotlin cannot decrypt the vault, so this holds only labels and match keys
 * (never passwords or private keys) and is stored under a hardware-backed device key.
 */
export interface AutofillLogin {
  id: string;
  title: string;
  /** Email or username shown to tell accounts apart. */
  username: string;
  /** Registrable domains: any host equal to or under one of these matches. */
  domains: string[];
  /** Exact hosts. */
  hosts: string[];
  /** Hosts that must never be offered this login. */
  never: string[];
  /** Android package names the user linked to this login. */
  packages: string[];
}

export interface AutofillPasskey {
  itemId: string;
  credentialId: string;
  rpId: string;
  userName: string;
  title: string;
  createdAt: number;
}

export interface AutofillIndex {
  v: 1;
  logins: AutofillLogin[];
  passkeys: AutofillPasskey[];
}

const APP_PREFIX = 'androidapp://';

export const androidAppUrl = (packageName: string): string => `${APP_PREFIX}${packageName}`;
export const packageOfUrl = (url: string): string | null =>
  url.startsWith(APP_PREFIX) ? url.slice(APP_PREFIX.length).trim() || null : null;

const uniq = (xs: string[]) => [...new Set(xs)];

export function buildAutofillIndex(items: ItemView[]): AutofillIndex {
  const logins: AutofillLogin[] = [];
  const passkeys: AutofillPasskey[] = [];
  for (const v of items) {
    if (v.deletedAt || v.item.type !== 'login') continue;
    const login = v.item as LoginItem;
    const domains: string[] = [];
    const hosts: string[] = [];
    const never: string[] = [];
    const packages: string[] = [];
    for (const rule of login.urls) {
      const pkg = packageOfUrl(rule.url);
      if (pkg) {
        if (rule.match !== 'never') packages.push(pkg);
        continue;
      }
      const host = hostnameOf(rule.url);
      if (!host || rule.match === 'regex') continue; // patterns need a full URL; the picker still lists them
      if (rule.match === 'never') never.push(host);
      else if (rule.match === 'host') hosts.push(host);
      else domains.push(baseDomain(host));
    }
    const username = identifierOf(login);
    if (login.password || username) {
      logins.push({
        id: v.id,
        title: login.title,
        username,
        domains: uniq(domains),
        hosts: uniq(hosts),
        never: uniq(never),
        packages: uniq(packages),
      });
    }
    for (const k of login.passkeys) {
      passkeys.push({
        itemId: v.id,
        credentialId: k.credentialId,
        rpId: k.rpId,
        userName: k.userName,
        title: login.title,
        createdAt: k.createdAt,
      });
    }
  }
  return { v: 1, logins, passkeys };
}
