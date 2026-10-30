import { and, eq, gt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { items, users, vaults } from '../db/schema';
import { ifMatch, parseBody, type Deps, type Env } from '../http';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const blob = (max: number) => z.string().min(1).max(max);

const vaultBody = z.object({
  wrappedVaultKey: blob(4096),
  encMeta: blob(16_384),
  deletedAt: z.number().int().nullable().default(null),
});
const itemBody = z.object({
  vaultId: id,
  type: z.enum(['login', 'note', 'card', 'identity', 'totp']),
  wrappedItemKey: blob(4096),
  ciphertext: blob(1_048_576),
  /** Client-chosen version (bound into the AAD); must increase on every write. */
  version: z.number().int().positive(),
  deletedAt: z.number().int().nullable().default(null),
});

type Tx = Parameters<Parameters<Deps['db']['transaction']>[0]>[0];

function bumpRev(tx: Tx, userId: string): number {
  return tx
    .update(users)
    .set({ rev: sql`${users.rev} + 1` })
    .where(eq(users.id, userId))
    .returning({ rev: users.rev })
    .get()!.rev;
}

const vaultView = (v: typeof vaults.$inferSelect) => ({
  id: v.id,
  wrappedVaultKey: v.wrappedVaultKey,
  encMeta: v.encMeta,
  rev: v.rev,
  deletedAt: v.deletedAt,
});
const itemView = (i: typeof items.$inferSelect) => ({
  id: i.id,
  vaultId: i.vaultId,
  type: i.type,
  wrappedItemKey: i.wrappedItemKey,
  ciphertext: i.ciphertext,
  version: i.version,
  rev: i.rev,
  updatedAt: i.updatedAt,
  deletedAt: i.deletedAt,
});

export function syncRoutes({ db, hub }: Deps) {
  const app = new Hono<Env>();

  /** Everything changed after revision `since` (0 = full pull). */
  app.get('/sync', (c) => {
    const userId = c.get('userId');
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isInteger(since) || since < 0)
      throw new HTTPException(400, { message: 'bad_since' });
    const rev = db.select({ rev: users.rev }).from(users).where(eq(users.id, userId)).get()!.rev;
    const vs = db
      .select()
      .from(vaults)
      .where(and(eq(vaults.userId, userId), gt(vaults.rev, since)))
      .all();
    const is = db
      .select()
      .from(items)
      .where(and(eq(items.userId, userId), gt(items.rev, since)))
      .all();
    return c.json({ rev, vaults: vs.map(vaultView), items: is.map(itemView) });
  });

  app.put('/vaults/:id', async (c) => {
    const userId = c.get('userId');
    const vid = id.safeParse(c.req.param('id'));
    if (!vid.success) throw new HTTPException(400, { message: 'bad_id' });
    const expected = ifMatch(c);
    const body = await parseBody(c, vaultBody);

    const result = db.transaction((tx) => {
      const cur = tx.select().from(vaults).where(eq(vaults.id, vid.data)).get();
      if (cur && cur.userId !== userId) return { conflict: null };
      if ((cur?.rev ?? 0) !== expected) return { conflict: cur ? vaultView(cur) : null };
      const rev = bumpRev(tx, userId);
      const row = { ...body, rev };
      if (cur) tx.update(vaults).set(row).where(eq(vaults.id, cur.id)).run();
      else
        tx.insert(vaults)
          .values({ id: vid.data, userId, ...row })
          .run();
      return { rev };
    });
    if ('conflict' in result) return c.json({ error: 'conflict', current: result.conflict }, 409);
    hub.notify(userId, result.rev);
    return c.json({ rev: result.rev });
  });

  app.put('/items/:id', async (c) => {
    const userId = c.get('userId');
    const iid = id.safeParse(c.req.param('id'));
    if (!iid.success) throw new HTTPException(400, { message: 'bad_id' });
    const expected = ifMatch(c);
    const body = await parseBody(c, itemBody);

    const result = db.transaction((tx) => {
      const vault = tx.select().from(vaults).where(eq(vaults.id, body.vaultId)).get();
      if (!vault || vault.userId !== userId) return { error: 'unknown_vault' as const };
      const cur = tx.select().from(items).where(eq(items.id, iid.data)).get();
      if (cur && cur.userId !== userId) return { conflict: null };
      if ((cur?.rev ?? 0) !== expected) return { conflict: cur ? itemView(cur) : null };
      if (cur && body.version <= cur.version) return { error: 'stale_version' as const };
      const rev = bumpRev(tx, userId);
      const row = { ...body, rev, updatedAt: Date.now() };
      if (cur) tx.update(items).set(row).where(eq(items.id, cur.id)).run();
      else
        tx.insert(items)
          .values({ id: iid.data, userId, ...row })
          .run();
      return { rev };
    });
    if ('error' in result) throw new HTTPException(400, { message: result.error });
    if ('conflict' in result) return c.json({ error: 'conflict', current: result.conflict }, 409);
    hub.notify(userId, result.rev);
    return c.json({ rev: result.rev });
  });

  return app;
}
