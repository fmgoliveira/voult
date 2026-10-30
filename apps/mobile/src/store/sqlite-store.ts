import { createMutexLock } from '@voult/core';
import type { ClientStore, LocalItem, LocalVault, OutboxOp } from '@voult/core';

/** The subset of expo-sqlite's SQLiteDatabase that we use (lets tests run on better-sqlite3). */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL,
  type TEXT NOT NULL,
  wrapped_item_key TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  version INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_vault ON items (vault_id);
CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY NOT NULL,
  wrapped_vault_key TEXT NOT NULL,
  enc_meta TEXT NOT NULL,
  rev INTEGER NOT NULL,
  deleted_at INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  base_rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_target ON outbox (kind, id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;

type Row = Record<string, unknown>;

const itemFromRow = (r: Row): LocalItem => ({
  id: r.id as string,
  vaultId: r.vault_id as string,
  type: r.type as string,
  wrappedItemKey: r.wrapped_item_key as string,
  ciphertext: r.ciphertext as string,
  version: r.version as number,
  rev: r.rev as number,
  updatedAt: r.updated_at as number,
  deletedAt: (r.deleted_at as number | null) ?? null,
  dirty: (r.dirty as number) === 1 ? 1 : 0,
});

const vaultFromRow = (r: Row): LocalVault => ({
  id: r.id as string,
  wrappedVaultKey: r.wrapped_vault_key as string,
  encMeta: r.enc_meta as string,
  rev: r.rev as number,
  deletedAt: (r.deleted_at as number | null) ?? null,
  dirty: (r.dirty as number) === 1 ? 1 : 0,
});

const outboxFromRow = (r: Row): OutboxOp => ({
  seq: r.seq as number,
  kind: r.kind as OutboxOp['kind'],
  id: r.id as string,
  baseRev: r.base_rev as number,
});

const ITEM_COLUMNS: Record<string, string> = {
  id: 'id',
  vaultId: 'vault_id',
  type: 'type',
  wrappedItemKey: 'wrapped_item_key',
  ciphertext: 'ciphertext',
  version: 'version',
  rev: 'rev',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  dirty: 'dirty',
};
const VAULT_COLUMNS: Record<string, string> = {
  id: 'id',
  wrappedVaultKey: 'wrapped_vault_key',
  encMeta: 'enc_meta',
  rev: 'rev',
  deletedAt: 'deleted_at',
  dirty: 'dirty',
};
const OUTBOX_COLUMNS: Record<string, string> = {
  seq: 'seq',
  kind: 'kind',
  id: 'id',
  baseRev: 'base_rev',
};

/** Build a partial UPDATE; unknown keys are ignored so callers cannot inject column names. */
function buildUpdate(
  table: string,
  keyColumn: string,
  columns: Record<string, string>,
  key: unknown,
  patch: object,
): [string, unknown[]] | null {
  const entries = Object.entries(patch).filter(([k]) => Object.hasOwn(columns, k));
  if (entries.length === 0) return null;
  return [
    `UPDATE ${table} SET ${entries.map(([k]) => `${columns[k]} = ?`).join(', ')} WHERE ${keyColumn} = ?`,
    [...entries.map(([, v]) => v ?? null), key],
  ];
}

/**
 * SQLite implementation of the shared ClientStore contract (single connection).
 * Transactions are serialised with a mutex and use BEGIN IMMEDIATE.
 */
export class SqliteStore implements ClientStore {
  private readonly lock = createMutexLock();

  private constructor(private readonly db: SqlDb) {}

  static async open(db: SqlDb): Promise<SqliteStore> {
    await db.execAsync(SCHEMA);
    return new SqliteStore(db);
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock('tx', async () => {
      await this.db.execAsync('BEGIN IMMEDIATE');
      try {
        const out = await fn();
        await this.db.execAsync('COMMIT');
        return out;
      } catch (e) {
        await this.db.execAsync('ROLLBACK');
        throw e;
      }
    });
  }

  // ---- items
  async getItem(id: string) {
    const r = await this.db.getFirstAsync<Row>('SELECT * FROM items WHERE id = ?', [id]);
    return r ? itemFromRow(r) : undefined;
  }
  async listItems() {
    return (await this.db.getAllAsync<Row>('SELECT * FROM items')).map(itemFromRow);
  }
  async putItem(i: LocalItem) {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO items (id, vault_id, type, wrapped_item_key, ciphertext, version, rev, updated_at, deleted_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        i.id,
        i.vaultId,
        i.type,
        i.wrappedItemKey,
        i.ciphertext,
        i.version,
        i.rev,
        i.updatedAt,
        i.deletedAt,
        i.dirty,
      ],
    );
  }
  async updateItem(id: string, patch: Partial<LocalItem>) {
    const q = buildUpdate('items', 'id', ITEM_COLUMNS, id, patch);
    if (q) await this.db.runAsync(q[0], q[1]);
  }
  async deleteItems(ids: string[]) {
    for (const id of ids) await this.db.runAsync('DELETE FROM items WHERE id = ?', [id]);
  }

  // ---- vaults
  async getVault(id: string) {
    const r = await this.db.getFirstAsync<Row>('SELECT * FROM vaults WHERE id = ?', [id]);
    return r ? vaultFromRow(r) : undefined;
  }
  async listVaults() {
    return (await this.db.getAllAsync<Row>('SELECT * FROM vaults')).map(vaultFromRow);
  }
  async putVault(v: LocalVault) {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO vaults (id, wrapped_vault_key, enc_meta, rev, deleted_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [v.id, v.wrappedVaultKey, v.encMeta, v.rev, v.deletedAt, v.dirty],
    );
  }
  async updateVault(id: string, patch: Partial<LocalVault>) {
    const q = buildUpdate('vaults', 'id', VAULT_COLUMNS, id, patch);
    if (q) await this.db.runAsync(q[0], q[1]);
  }

  // ---- outbox
  async listOutbox() {
    return (await this.db.getAllAsync<Row>('SELECT * FROM outbox ORDER BY seq')).map(outboxFromRow);
  }
  async getOutbox(seq: number) {
    const r = await this.db.getFirstAsync<Row>('SELECT * FROM outbox WHERE seq = ?', [seq]);
    return r ? outboxFromRow(r) : undefined;
  }
  async findOutbox(kind: OutboxOp['kind'], id: string) {
    const r = await this.db.getFirstAsync<Row>(
      'SELECT * FROM outbox WHERE kind = ? AND id = ? ORDER BY seq LIMIT 1',
      [kind, id],
    );
    return r ? outboxFromRow(r) : undefined;
  }
  async addOutbox(op: Omit<OutboxOp, 'seq'>) {
    await this.db.runAsync('INSERT INTO outbox (kind, id, base_rev) VALUES (?, ?, ?)', [
      op.kind,
      op.id,
      op.baseRev,
    ]);
  }
  async updateOutbox(seq: number, patch: Partial<OutboxOp>) {
    const q = buildUpdate('outbox', 'seq', OUTBOX_COLUMNS, seq, patch);
    if (q) await this.db.runAsync(q[0], q[1]);
  }
  async deleteOutbox(seq: number) {
    await this.db.runAsync('DELETE FROM outbox WHERE seq = ?', [seq]);
  }

  // ---- meta
  async getMeta<T>(key: string) {
    const r = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      [key],
    );
    return r ? (JSON.parse(r.value) as T) : undefined;
  }
  async setMeta(key: string, value: unknown) {
    await this.db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      key,
      JSON.stringify(value),
    ]);
  }
  async clearAll() {
    await this.db.execAsync(
      'DELETE FROM items; DELETE FROM vaults; DELETE FROM outbox; DELETE FROM meta;',
    );
  }
}
