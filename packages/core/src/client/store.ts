import type { AccountMeta, LocalItem, LocalVault, OutboxOp } from './types';

/**
 * Local persistence used by the sync engine and vault client. Implemented with IndexedDB
 * (Dexie) in the extension and SQLite on Android.
 *
 * `transaction` must make every call made inside `fn` atomic and isolated from other callers.
 */
export interface ClientStore {
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  getItem(id: string): Promise<LocalItem | undefined>;
  listItems(): Promise<LocalItem[]>;
  putItem(item: LocalItem): Promise<void>;
  updateItem(id: string, patch: Partial<LocalItem>): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;

  getVault(id: string): Promise<LocalVault | undefined>;
  listVaults(): Promise<LocalVault[]>;
  putVault(vault: LocalVault): Promise<void>;
  updateVault(id: string, patch: Partial<LocalVault>): Promise<void>;

  /** Ordered by `seq`. */
  listOutbox(): Promise<OutboxOp[]>;
  getOutbox(seq: number): Promise<OutboxOp | undefined>;
  findOutbox(kind: OutboxOp['kind'], id: string): Promise<OutboxOp | undefined>;
  addOutbox(op: Omit<OutboxOp, 'seq'>): Promise<void>;
  updateOutbox(seq: number, patch: Partial<OutboxOp>): Promise<void>;
  deleteOutbox(seq: number): Promise<void>;

  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  clearAll(): Promise<void>;
}

export const getAccount = (store: ClientStore) => store.getMeta<AccountMeta>('account');

/** Serialises async work in this process; swap for Web Locks where several contexts share state. */
export type LockFn = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export function createMutexLock(): LockFn {
  const tails = new Map<string, Promise<unknown>>();
  return (name, fn) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(() => fn());
    tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  };
}
