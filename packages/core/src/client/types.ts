import type { Item, VaultMeta } from '../vault/schemas';

/** Encrypted records exactly as the server stores them, plus local sync flags. */
export interface LocalItem {
  id: string;
  vaultId: string;
  type: string;
  wrappedItemKey: string;
  ciphertext: string;
  /** Client-chosen version (AAD). */
  version: number;
  /** Last server revision this record was synced at. */
  rev: number;
  updatedAt: number;
  deletedAt: number | null;
  /** 1 when there are local changes not yet accepted by the server. */
  dirty: 0 | 1;
}

export interface LocalVault {
  id: string;
  wrappedVaultKey: string;
  encMeta: string;
  rev: number;
  deletedAt: number | null;
  dirty: 0 | 1;
}

/** Pending push, ordered by seq. The record itself lives in items/vaults. */
export interface OutboxOp {
  seq: number;
  kind: 'item' | 'vault';
  id: string;
  /** Server rev the first queued change was based on (0 = create). */
  baseRev: number;
}

export interface KdfParamsMeta {
  m: number;
  t: number;
  p: number;
}

export interface AccountMeta {
  email: string;
  serverUrl: string;
  userId: string;
  deviceId: string;
  kdfParams: KdfParamsMeta;
  salt: string;
  wrappedAccountKey: string;
  wrappedRecoveryKey: string;
  /** User confirmed they stored the recovery kit; required before saving the first item. */
  recoveryConfirmed: boolean;
}

export interface DeviceInfo {
  name: string;
  platform: 'chrome' | 'firefox' | 'android' | 'other';
}

export interface VaultView {
  id: string;
  meta: VaultMeta;
}

export interface ItemView {
  id: string;
  vaultId: string;
  item: Item;
  deletedAt: number | null;
  dirty: boolean;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Set when sync stopped early (offline, locked while a conflict needed merging…). */
  error?: string;
}
