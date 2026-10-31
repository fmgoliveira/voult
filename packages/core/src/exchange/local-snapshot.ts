import { getAccount, type ClientStore } from '../client/store';
import type { Snapshot } from './snapshot';

/**
 * Builds an encrypted, self-contained snapshot (.voult file) from the local store. Only the
 * encrypted records are copied: it needs no unlocked key and holds no plaintext.
 */
export async function snapshotFromStore(
  store: ClientStore,
  now: number = Date.now(),
): Promise<Snapshot> {
  const account = await getAccount(store);
  if (!account) throw new Error('no_account');
  const [vaults, items] = await Promise.all([store.listVaults(), store.listItems()]);
  return {
    format: 'voult-snapshot',
    version: 1,
    createdAt: now,
    email: account.email,
    kdfParams: account.kdfParams,
    salt: account.salt,
    wrappedAccountKey: account.wrappedAccountKey,
    wrappedRecoveryKey: account.wrappedRecoveryKey,
    vaults: vaults.map((v) => ({
      id: v.id,
      wrappedVaultKey: v.wrappedVaultKey,
      encMeta: v.encMeta,
      deletedAt: v.deletedAt,
    })),
    items: items.map((i) => ({
      id: i.id,
      vaultId: i.vaultId,
      type: i.type,
      wrappedItemKey: i.wrappedItemKey,
      ciphertext: i.ciphertext,
      version: i.version,
      rev: i.rev,
      updatedAt: i.updatedAt,
      deletedAt: i.deletedAt,
    })),
  };
}
