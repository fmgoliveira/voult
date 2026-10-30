import { isPurgeable, type Item } from '@voult/core';
import type { ItemView } from './vault';

export type SortKey = 'title' | 'updated' | 'created';
export type TypeFilter = 'all' | Item['type'];

export interface ListQuery {
  text: string;
  type: TypeFilter;
  vaultId: 'all' | string;
  sort: SortKey;
  trash: boolean;
}

function haystack(v: ItemView): string[] {
  const i = v.item;
  const parts = [i.title, i.notes];
  if (i.type === 'login') {
    parts.push(i.username, i.email, ...i.urls.map((u) => u.url));
  } else if (i.type === 'identity') {
    parts.push(i.fullName, i.email);
  } else if (i.type === 'card') {
    parts.push(i.holder);
  } else if (i.type === 'totp') {
    parts.push(i.totp.issuer, i.totp.account);
  }
  return parts.map((p) => p.toLowerCase());
}

export function matchesText(v: ItemView, text: string): boolean {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(v);
  return terms.every((t) => hay.some((h) => h.includes(t)));
}

/** Items hidden from every list: purged (long-trashed) records still waiting to sync away. */
export const isPurged = (v: ItemView, now = Date.now()): boolean =>
  v.deletedAt !== null && isPurgeable(v.deletedAt, now);

export function queryItems(items: ItemView[], q: ListQuery, now = Date.now()): ItemView[] {
  const out = items.filter(
    (v) =>
      !isPurged(v, now) &&
      (v.deletedAt !== null) === q.trash &&
      (q.type === 'all' || v.item.type === q.type) &&
      (q.vaultId === 'all' || v.vaultId === q.vaultId) &&
      matchesText(v, q.text),
  );
  const cmp: Record<SortKey, (a: ItemView, b: ItemView) => number> = {
    title: (a, b) => a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base' }),
    updated: (a, b) => b.item.updatedAt - a.item.updatedAt,
    created: (a, b) => b.item.createdAt - a.item.createdAt,
  };
  // Pinned first, then favourites, then the chosen order.
  return out.sort(
    (a, b) =>
      Number(b.item.pinned) - Number(a.item.pinned) ||
      Number(b.item.favorite) - Number(a.item.favorite) ||
      cmp[q.sort](a, b),
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}
