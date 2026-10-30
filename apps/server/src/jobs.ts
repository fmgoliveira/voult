import { and, isNotNull, lt } from 'drizzle-orm';
import type { Db } from './db';
import { items, vaults } from './db/schema';

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Permanently remove items/vaults that have sat in the trash for 30 days. */
export function purgeTrash(db: Db, now = Date.now()): { items: number; vaults: number } {
  const cutoff = now - TRASH_RETENTION_MS;
  const i = db
    .delete(items)
    .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)))
    .run().changes;
  const v = db
    .delete(vaults)
    .where(and(isNotNull(vaults.deletedAt), lt(vaults.deletedAt, cutoff)))
    .run().changes;
  return { items: i, vaults: v };
}
