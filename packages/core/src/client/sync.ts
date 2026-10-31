import { decryptItem, encryptItem, isPurgeable, openVault, resolveConflict } from '../vault/ops';
import type { VaultMeta } from '../vault/schemas';
import { ApiError, SignedOutError } from './errors';
import type { Http } from './http';
import type { ClientStore, LockFn } from './store';
import type { LocalItem, LocalVault, SyncResult } from './types';

export interface UnlockedVault {
  id: string;
  vaultKey: Uint8Array;
  meta: VaultMeta;
  deletedAt: number | null;
}

/** Decrypt all vault keys + metadata with the account key. Unreadable records are skipped. */
export async function openVaults(
  store: ClientStore,
  accountKey: Uint8Array,
): Promise<Map<string, UnlockedVault>> {
  const out = new Map<string, UnlockedVault>();
  for (const v of await store.listVaults()) {
    try {
      const { vaultKey, meta } = openVault(accountKey, v);
      out.set(v.id, { id: v.id, vaultKey, meta, deletedAt: v.deletedAt });
    } catch {
      /* a record we cannot open must not break the whole vault */
    }
  }
  return out;
}

export interface SyncDeps {
  store: ClientStore;
  http: Http;
  lock: LockFn;
  /** Null while locked: conflicts that need decrypting are then retried after unlock. */
  getAccountKey: () => Promise<Uint8Array | null>;
  now?: () => number;
}

const MAX_CONFLICT_RETRIES = 5;

export function createSyncEngine(deps: SyncDeps) {
  const { store, http } = deps;
  const now = deps.now ?? Date.now;

  /** Merge the server's version into the local item after a 409, re-encrypting on top of it. */
  async function mergeItemConflict(local: LocalItem, remote: LocalItem): Promise<boolean> {
    const accountKey = await deps.getAccountKey();
    if (!accountKey) return false;
    const vault = (await openVaults(store, accountKey)).get(local.vaultId);
    if (!vault) return false;
    const mine = decryptItem(vault.vaultKey, local.id, local.version, local);
    const theirs = decryptItem(vault.vaultKey, remote.id, remote.version, remote);
    const merged = resolveConflict(mine, theirs);
    const version = Math.max(local.version, remote.version) + 1;
    const enc = encryptItem(vault.vaultKey, local.id, version, merged);
    await store.transaction(async () => {
      await store.putItem({
        ...local,
        ...enc,
        version,
        rev: remote.rev,
        // The newer edit (including trash/restore) decides the trashed state.
        deletedAt: mine.updatedAt >= theirs.updatedAt ? local.deletedAt : remote.deletedAt,
        dirty: 1,
      });
      const op = await store.findOutbox('item', local.id);
      if (op) await store.updateOutbox(op.seq, { baseRev: remote.rev });
    });
    return true;
  }

  async function pushAll(): Promise<{ pushed: number; error?: string }> {
    let pushed = 0;
    for (const op of await store.listOutbox()) {
      for (let attempt = 0; ; attempt++) {
        const current =
          op.kind === 'item' ? await store.getItem(op.id) : await store.getVault(op.id);
        if (!current) {
          await store.deleteOutbox(op.seq);
          break;
        }
        const baseRev = (await store.getOutbox(op.seq))?.baseRev ?? op.baseRev;
        const { path, body } =
          op.kind === 'item' ? itemPush(current as LocalItem) : vaultPush(current as LocalVault);

        let res;
        try {
          res = await http.request('PUT', path, body, { 'if-match': String(baseRev) });
        } catch (e) {
          if (e instanceof SignedOutError) throw e;
          return { pushed, error: 'offline' };
        }

        if (res.status === 200) {
          const rev = res.json!.rev as number;
          await store.transaction(async () => {
            const latest =
              op.kind === 'item' ? await store.getItem(op.id) : await store.getVault(op.id);
            // If the user edited again while we were pushing, keep the record dirty.
            const unchanged =
              !!latest &&
              (op.kind === 'item'
                ? (latest as LocalItem).version === (current as LocalItem).version
                : (latest as LocalVault).encMeta === (current as LocalVault).encMeta &&
                  (latest as LocalVault).deletedAt === (current as LocalVault).deletedAt);
            if (latest) {
              const patch = { rev, ...(unchanged ? { dirty: 0 as const } : {}) };
              if (op.kind === 'item') await store.updateItem(op.id, patch);
              else await store.updateVault(op.id, patch);
            }
            if (unchanged) await store.deleteOutbox(op.seq);
            else await store.updateOutbox(op.seq, { baseRev: rev });
          });
          pushed++;
          break;
        }

        if (res.status === 409 && attempt < MAX_CONFLICT_RETRIES) {
          const remote = res.json?.current as LocalItem | LocalVault | null | undefined;
          if (!remote) {
            // The id belongs to someone else: unrecoverable for this op.
            await store.deleteOutbox(op.seq);
            break;
          }
          if (op.kind === 'item') {
            if (!(await mergeItemConflict(current as LocalItem, remote as LocalItem))) {
              return { pushed, error: 'locked' };
            }
          } else {
            // Vault metadata: the local edit wins, rebased on the server revision.
            await store.updateVault(op.id, { rev: remote.rev });
            await store.updateOutbox(op.seq, { baseRev: remote.rev });
          }
          continue;
        }
        if (res.status >= 500 || res.status === 429) return { pushed, error: 'server' };
        // Permanent rejection (bad request): drop the op so it cannot block the queue.
        await store.deleteOutbox(op.seq);
        break;
      }
    }
    return { pushed };
  }

  async function pullAll(): Promise<number> {
    const since = (await store.getMeta<number>('lastRev')) ?? 0;
    const res = await http.request('GET', `/sync?since=${since}`);
    if (res.status !== 200 || !res.json) throw new ApiError(res.status, 'sync_failed', res.json);
    const data = res.json as unknown as {
      rev: number;
      vaults: Omit<LocalVault, 'dirty'>[];
      items: Omit<LocalItem, 'dirty'>[];
    };
    let pulled = 0;
    await store.transaction(async () => {
      for (const v of data.vaults) {
        if ((await store.getVault(v.id))?.dirty) continue; // resolved at push time
        await store.putVault({ ...v, dirty: 0 });
        pulled++;
      }
      for (const i of data.items) {
        if ((await store.getItem(i.id))?.dirty) continue;
        await store.putItem({ ...i, dirty: 0 });
        pulled++;
      }
      await store.setMeta('lastRev', data.rev);
    });
    return pulled;
  }

  async function purgeLocalTrash(): Promise<void> {
    const t = now();
    const ids = (await store.listItems())
      .filter((i) => i.deletedAt !== null && !i.dirty && isPurgeable(i.deletedAt, t))
      .map((i) => i.id);
    if (ids.length) await store.deleteItems(ids);
  }

  /** Push local changes, then pull remote ones. Safe to call from any context. */
  function syncOnce(): Promise<SyncResult> {
    return deps.lock('voult-sync', async () => {
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

  return { syncOnce };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

function itemPush(i: LocalItem) {
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

function vaultPush(v: LocalVault) {
  return {
    path: `/vaults/${v.id}`,
    body: { wrappedVaultKey: v.wrappedVaultKey, encMeta: v.encMeta, deletedAt: v.deletedAt },
  };
}
