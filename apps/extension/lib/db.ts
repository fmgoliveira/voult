import type { AccountMeta, ClientStore, LocalItem, LocalVault, OutboxOp } from '@voult/core';
import Dexie, { type EntityTable } from 'dexie';

export type { AccountMeta, LocalItem, LocalVault, OutboxOp };

export interface MetaRow {
  key: string;
  value: unknown;
}

type OutboxRow = Omit<OutboxOp, 'seq'> & { seq?: number };

export class VoultDB extends Dexie {
  items!: EntityTable<LocalItem, 'id'>;
  vaults!: EntityTable<LocalVault, 'id'>;
  outbox!: EntityTable<OutboxRow, 'seq'>;
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
}

/** IndexedDB implementation of the shared ClientStore contract. */
export class DexieStore implements ClientStore {
  constructor(private readonly db: VoultDB) {}

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    const { items, vaults, outbox, meta } = this.db;
    return this.db.transaction('rw', items, vaults, outbox, meta, fn);
  }

  getItem = (id: string) => this.db.items.get(id);
  listItems = () => this.db.items.toArray();
  putItem = async (i: LocalItem) => void (await this.db.items.put(i));
  updateItem = async (id: string, patch: Partial<LocalItem>) =>
    void (await this.db.items.update(id, patch));
  deleteItems = (ids: string[]) => this.db.items.bulkDelete(ids);

  getVault = (id: string) => this.db.vaults.get(id);
  listVaults = () => this.db.vaults.toArray();
  putVault = async (v: LocalVault) => void (await this.db.vaults.put(v));
  updateVault = async (id: string, patch: Partial<LocalVault>) =>
    void (await this.db.vaults.update(id, patch));

  listOutbox = async () => (await this.db.outbox.orderBy('seq').toArray()) as OutboxOp[];
  getOutbox = async (seq: number) => (await this.db.outbox.get(seq)) as OutboxOp | undefined;
  findOutbox = async (kind: OutboxOp['kind'], id: string) =>
    (await this.db.outbox.where({ kind, id }).first()) as OutboxOp | undefined;
  addOutbox = async (op: Omit<OutboxOp, 'seq'>) => void (await this.db.outbox.add(op));
  updateOutbox = async (seq: number, patch: Partial<OutboxOp>) =>
    void (await this.db.outbox.update(seq, patch));
  deleteOutbox = (seq: number) => this.db.outbox.delete(seq);

  getMeta = <T>(key: string) => this.db.getMeta<T>(key);
  setMeta = (key: string, value: unknown) => this.db.setMeta(key, value);
  async clearAll(): Promise<void> {
    const { items, vaults, outbox, meta } = this.db;
    await Promise.all([items.clear(), vaults.clear(), outbox.clear(), meta.clear()]);
  }
}

export const db = new VoultDB();
export const store: ClientStore = new DexieStore(db);
