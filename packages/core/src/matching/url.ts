import { getDomain, parse } from 'tldts';
import type { LoginItem } from '../vault/schemas';

type UrlRule = LoginItem['urls'][number];

function toUrl(raw: string): URL | null {
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

export const hostnameOf = (raw: string): string | null =>
  toUrl(raw)?.hostname.toLowerCase() ?? null;

/**
 * Registrable domain via the Public Suffix List (example.co.uk, not co.uk).
 * IPs, localhost and unknown suffixes fall back to the exact host so they never
 * match their siblings.
 */
export function baseDomain(host: string): string {
  const h = host.toLowerCase();
  const p = parse(h, { allowPrivateDomains: true });
  if (p.isIp || !p.domain) return h;
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

/** Whether Voult may autofill on this page at all: https, or http only on loopback. */
export function isFillableUrl(raw: string): boolean {
  const u = toUrl(raw);
  if (!u) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

/** Does one stored URL rule match the page? (`never` rules are handled by `matchLogin`.) */
export function ruleMatches(rule: UrlRule, pageUrl: string): boolean {
  const page = toUrl(pageUrl);
  if (!page) return false;
  if (rule.match === 'regex') {
    try {
      return new RegExp(rule.url).test(page.href);
    } catch {
      return false; // a broken pattern must never match everything
    }
  }
  const stored = toUrl(rule.url);
  if (!stored) return false;
  if (rule.match === 'host' || rule.match === 'never') {
    return stored.host.toLowerCase() === page.host.toLowerCase();
  }
  return baseDomain(stored.hostname) === baseDomain(page.hostname);
}

/** A login matches when some rule matches and no `never` rule does. */
export function matchLogin(login: Pick<LoginItem, 'urls'>, pageUrl: string): boolean {
  if (!isFillableUrl(pageUrl)) return false;
  const rules = login.urls.filter((r) => r.url.trim());
  const blocked = rules.some((r) => r.match === 'never' && ruleMatches(r, pageUrl));
  if (blocked) return false;
  return rules.some((r) => r.match !== 'never' && ruleMatches(r, pageUrl));
}
