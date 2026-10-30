import { openVault, type VaultMeta } from '@voult/core';
import { db } from './db';

export interface OpenedVault {
  id: string;
  vaultKey: Uint8Array;
  meta: VaultMeta;
  deletedAt: number | null;
}

/** Decrypt all vault keys + metadata with the account key. */
export async function openVaults(accountKey: Uint8Array): Promise<Map<string, OpenedVault>> {
  const out = new Map<string, OpenedVault>();
  for (const v of await db.vaults.toArray()) {
    try {
      const { vaultKey, meta } = openVault(accountKey, v);
      out.set(v.id, { id: v.id, vaultKey, meta, deletedAt: v.deletedAt });
    } catch {
      // A record we cannot open is skipped rather than breaking the whole vault.
    }
  }
  return out;
}
