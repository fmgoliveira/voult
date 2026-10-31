import type { Item } from '../vault/schemas';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const looksLikeEmail = (value: string) => EMAIL.test(value.trim());

/** One "email or username" input maps onto the login's two stored fields. */
export function inferIdentifier(value: string): { username: string; email: string } {
  const v = value.trim();
  return looksLikeEmail(v) ? { username: '', email: v } : { username: v, email: '' };
}

/** What the single input shows for a login that may have either (or, from old data, both). */
export const identifierOf = (login: { username: string; email: string }) =>
  login.username || login.email;

export interface IdentifierSuggestion {
  value: string;
  /** Number of logins that use it. */
  count: number;
}

/** Previously used emails/usernames, most-used first, optionally narrowed by what is typed. */
export function identifierSuggestions(
  items: readonly Item[],
  query = '',
  limit = 5,
): IdentifierSuggestion[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const it of items) {
    if (it.type !== 'login') continue;
    for (const raw of new Set([it.username, it.email])) {
      const v = raw.trim();
      if (!v) continue;
      const key = v.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { value: v, count: 1 });
    }
  }
  const q = query.trim().toLowerCase();
  return [...counts.values()]
    .filter((s) => s.value.toLowerCase() !== q && (!q || s.value.toLowerCase().includes(q)))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/** The icon a service serves itself, fetched straight from its own site (no third-party lookup). */
export function faviconUrl(urls: readonly { url: string }[]): string | null {
  for (const { url } of urls) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost'))
        continue;
      if (!u.hostname.includes('.') && u.hostname !== 'localhost') continue;
      return `${u.origin}/favicon.ico`;
    } catch {
      /* try the next URL */
    }
  }
  return null;
}
