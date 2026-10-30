import { decryptItem, encryptItem, isPurgeable, resolveConflict } from '@voult/core';
import { ApiError, request, SignedOutError } from './api';
import { db, type LocalItem, type LocalVault } from './db';
import { openVaults } from './keys';
import { getAccountKey } from './session';

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Set when sync stopped early (offline, locked while a conflict needed merging…). */
  error?: string;
}

const MAX_CONFLICT_RETRIES = 5;

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(name, fn) : fn();
}

interface Pushable {
  path: string;
  body: Record<string, unknown>;
}

function itemPush(i: LocalItem): Pushable {
  return {
    path: `/items/${i.id}`,
    body: {
      vaultId: i.vaultId,
      type: i.type,
      wrappedItemKey: i.wrappedItemKey,
      ciphertext: i.ciphertext,
      version: i.version,
      deletedAt: i.deletedAt,
    },
  };
}
function vaultPush(v: LocalVault): Pushable {
  return {
    path: `/vaults/${v.id}`,
    body: { wrappedVaultKey: v.wrappedVaultKey, encMeta: v.encMeta, deletedAt: v.deletedAt },
  };
}

/** Merge a server-side version into the local item after a 409, re-encrypting on top of it. */
async function mergeItemConflict(local: LocalItem, remote: LocalItem): Promise<boolean> {
  const accountKey = await getAccountKey();
  if (!accountKey) return false; // locked: cannot decrypt, retry on next sync after unlock
  const vault = (await openVaults(accountKey)).get(local.vaultId);
  if (!vault) return false;
  const mine = decryptItem(vault.vaultKey, local.id, local.version, local);
  const theirs = decryptItem(vault.vaultKey, remote.id, remote.version, remote);
  const merged = resolveConflict(mine, theirs);
  const version = Math.max(local.version, remote.version) + 1;
  const enc = encryptItem(vault.vaultKey, local.id, version, merged);
  await db.transaction('rw', db.items, db.outbox, async () => {
    await db.items.put({
      ...local,
      ...enc,
      version,
      rev: remote.rev,
      // The newer edit (including trash/restore) decides the trashed state.
      deletedAt: mine.updatedAt >= theirs.updatedAt ? local.deletedAt : remote.deletedAt,
      dirty: 1,
    });
    await db.outbox.where({ kind: 'item', id: local.id }).modify({ baseRev: remote.rev });
  });
  return true;
}

async function pushAll(): Promise<{ pushed: number; error?: string }> {
  let pushed = 0;
  for (const op of await db.outbox.orderBy('seq').toArray()) {
    for (let attempt = 0; ; attempt++) {
      const current = op.kind === 'item' ? await db.items.get(op.id) : await db.vaults.get(op.id);
      if (!current) {
        await db.outbox.delete(op.seq!);
        break;
      }
      const baseRev = (await db.outbox.get(op.seq!))?.baseRev ?? op.baseRev;
      const { path, body } =
        op.kind === 'item' ? itemPush(current as LocalItem) : vaultPush(current as LocalVault);

      let res;
      try {
        res = await request('PUT', path, body, { 'if-match': String(baseRev) });
      } catch (e) {
        if (e instanceof SignedOutError) throw e;
        return { pushed, error: 'offline' };
      }

      if (res.status === 200) {
        const rev = res.json!.rev as number;
        await db.transaction('rw', db.items, db.vaults, db.outbox, async () => {
          const table = op.kind === 'item' ? db.items : db.vaults;
          const now = await table.get(op.id);
          const unchanged =
            now &&
            (op.kind === 'item'
              ? (now as LocalItem).version === (current as LocalItem).version
              : (now as LocalVault).encMeta === (current as LocalVault).encMeta &&
                (now as LocalVault).deletedAt === (current as LocalVault).deletedAt);
          if (now) await table.update(op.id, { rev, ...(unchanged ? { dirty: 0 } : {}) } as never);
          if (unchanged) await db.outbox.delete(op.seq!);
          else await db.outbox.update(op.seq!, { baseRev: rev });
        });
        pushed++;
        break;
      }

      if (res.status === 409 && attempt < MAX_CONFLICT_RETRIES) {
        const remote = res.json?.current as (LocalItem | LocalVault) | null;
        if (!remote) {
          // Id belongs to someone else: unrecoverable for this op.
          await db.outbox.delete(op.seq!);
          break;
        }
        if (op.kind === 'item') {
          if (!(await mergeItemConflict(current as LocalItem, remote as LocalItem))) {
            return { pushed, error: 'locked' };
          }
        } else {
          // Vault metadata: local edit wins, rebased on the server revision.
          await db.vaults.update(op.id, { rev: remote.rev });
          await db.outbox.update(op.seq!, { baseRev: remote.rev });
        }
        continue;
      }
      if (res.status >= 500 || res.status === 429) return { pushed, error: 'server' };
      // Permanent rejection (bad request): drop the op so it cannot block the queue.
      await db.outbox.delete(op.seq!);
      break;
    }
  }
  return { pushed };
}

async function pullAll(): Promise<number> {
  const since = (await db.getMeta<number>('lastRev')) ?? 0;
  const res = await request('GET', `/sync?since=${since}`);
  if (res.status !== 200 || !res.json) throw new ApiError(res.status, 'sync_failed', res.json);
  const data = res.json as unknown as {
    rev: number;
    vaults: Omit<LocalVault, 'dirty'>[];
    items: Omit<LocalItem, 'dirty'>[];
  };
  let pulled = 0;
  await db.transaction('rw', db.items, db.vaults, db.meta, async () => {
    for (const v of data.vaults) {
      if ((await db.vaults.get(v.id))?.dirty) continue; // conflict resolved at push time
      await db.vaults.put({ ...v, dirty: 0 });
      pulled++;
    }
    for (const i of data.items) {
      if ((await db.items.get(i.id))?.dirty) continue;
      await db.items.put({ ...i, dirty: 0 });
      pulled++;
    }
    await db.setMeta('lastRev', data.rev);
  });
  return pulled;
}

async function purgeLocalTrash(now = Date.now()): Promise<void> {
  const trashed = await db.items.where('deletedAt').above(-1).toArray();
  const ids = trashed.filter((i) => !i.dirty && isPurgeable(i.deletedAt!, now)).map((i) => i.id);
  if (ids.length) await db.items.bulkDelete(ids);
}

/** Push local changes, then pull remote ones. Safe to call from any context. */
export function syncOnce(): Promise<SyncResult> {
  return withLock('voult-sync', async () => {
    const pushed = await pushAll();
    let pulled = 0;
    try {
      pulled = await pullAll();
    } catch (e) {
      if (e instanceof SignedOutError) throw e;
      return { ...pushed, pulled, error: pushed.error ?? 'offline' };
    }
    await purgeLocalTrash();
    return { pushed: pushed.pushed, pulled, error: pushed.error };
  });
}
