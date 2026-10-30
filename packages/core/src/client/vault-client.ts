import { newId, decryptItem, encryptItem, updateLogin } from '../vault/ops';
import type { Item, LoginItem } from '../vault/schemas';
import { VaultLockedError } from './errors';
import { openVaults } from './sync';
import { getAccount, type ClientStore } from './store';
import type { ItemView, VaultView } from './types';

export interface VaultClientDeps {
  store: ClientStore;
  getAccountKey: () => Promise<Uint8Array | null>;
  /** Called after every local write so the platform can schedule a sync. */
  requestSync: () => void;
  now?: () => number;
}

export function createVaultClient(deps: VaultClientDeps) {
  const { store } = deps;
  const now = deps.now ?? Date.now;

  /** Decrypt everything the user can see. Undecryptable records are skipped, not fatal. */
  async function loadVault(): Promise<{ vaults: VaultView[]; items: ItemView[] }> {
    const accountKey = await deps.getAccountKey();
    if (!accountKey) throw new VaultLockedError();
    const vaults = await openVaults(store, accountKey);
    const items: ItemView[] = [];
    for (const r of await store.listItems()) {
      const v = vaults.get(r.vaultId);
      if (!v) continue;
      try {
        items.push({
          id: r.id,
          vaultId: r.vaultId,
          item: decryptItem(v.vaultKey, r.id, r.version, r),
          deletedAt: r.deletedAt,
          dirty: r.dirty === 1,
        });
      } catch {
        /* skip */
      }
    }
    return {
      vaults: [...vaults.values()]
        .filter((v) => !v.deletedAt)
        .map((v) => ({ id: v.id, meta: v.meta })),
      items,
    };
  }

  async function writeItem(
    id: string,
    vaultId: string,
    item: Item,
    deletedAt: number | null,
  ): Promise<void> {
    const account = await getAccount(store);
    if (account && !account.recoveryConfirmed) throw new Error('recovery_kit_required');
    const accountKey = await deps.getAccountKey();
    if (!accountKey) throw new VaultLockedError();
    const vault = (await openVaults(store, accountKey)).get(vaultId);
    if (!vault) throw new Error('unknown_vault');

    await store.transaction(async () => {
      const prev = await store.getItem(id);
      const version = (prev?.version ?? 0) + 1;
      const enc = encryptItem(vault.vaultKey, id, version, item);
      await store.putItem({
        id,
        vaultId,
        type: item.type,
        ...enc,
        version,
        rev: prev?.rev ?? 0,
        updatedAt: item.updatedAt,
        deletedAt,
        dirty: 1,
      });
      if (!(await store.findOutbox('item', id))) {
        await store.addOutbox({ kind: 'item', id, baseRev: prev?.rev ?? 0 });
      }
    });
    deps.requestSync();
  }

  async function saveItem(vaultId: string, item: Item, id: string = newId()): Promise<string> {
    await writeItem(id, vaultId, { ...item, updatedAt: now() }, null);
    return id;
  }

  /** Edit a login, keeping password history. */
  async function saveLoginEdit(view: ItemView, patch: Partial<LoginItem>): Promise<void> {
    if (view.item.type !== 'login') throw new Error('not_a_login');
    await writeItem(view.id, view.vaultId, updateLogin(view.item, patch, now()), view.deletedAt);
  }

  async function trashItem(view: ItemView): Promise<void> {
    const t = now();
    await writeItem(view.id, view.vaultId, { ...view.item, updatedAt: t }, t);
  }

  async function restoreItem(view: ItemView): Promise<void> {
    await writeItem(view.id, view.vaultId, { ...view.item, updatedAt: now() }, null);
  }

  /** Marks the item as trashed long ago so every device (and the server job) purges it. */
  async function purgeItem(view: ItemView): Promise<void> {
    await writeItem(view.id, view.vaultId, { ...view.item, updatedAt: now() }, 1);
  }

  return {
    loadVault,
    saveItem,
    saveLoginEdit,
    trashItem,
    restoreItem,
    purgeItem,
  };
}

export type VaultClient = ReturnType<typeof createVaultClient>;
