import Dexie, { type EntityTable } from 'dexie';

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
  seq?: number;
  kind: 'item' | 'vault';
  id: string;
  /** Server rev the first queued change was based on (0 = create). */
  baseRev: number;
}

export interface AccountMeta {
  email: string;
  serverUrl: string;
  userId: string;
  deviceId: string;
  kdfParams: { m: number; t: number; p: number };
  salt: string;
  wrappedAccountKey: string;
  wrappedRecoveryKey: string;
  /** User confirmed they stored the recovery kit; required before saving the first item. */
  recoveryConfirmed: boolean;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class VoultDB extends Dexie {
  items!: EntityTable<LocalItem, 'id'>;
  vaults!: EntityTable<LocalVault, 'id'>;
  outbox!: EntityTable<OutboxOp, 'seq'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'voult') {
    super(name);
    this.version(1).stores({
      items: 'id, vaultId, deletedAt, dirty',
      vaults: 'id, dirty',
      outbox: '++seq, [kind+id]',
      meta: 'key',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
  async getAccount(): Promise<AccountMeta | undefined> {
    return this.getMeta<AccountMeta>('account');
  }
  async clearAll(): Promise<void> {
    await Promise.all([
      this.items.clear(),
      this.vaults.clear(),
      this.outbox.clear(),
      this.meta.clear(),
    ]);
  }
}

export const db = new VoultDB();
