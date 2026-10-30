import { createMutexLock } from './store';
import type { ClientStore } from './store';
import type { LocalItem, LocalVault, OutboxOp } from './types';

/** In-memory store: used by tests and as a reference implementation of the contract. */
export class MemoryStore implements ClientStore {
  private items = new Map<string, LocalItem>();
  private vaults = new Map<string, LocalVault>();
  private outbox: OutboxOp[] = [];
  private meta = new Map<string, unknown>();
  private seq = 0;
  private readonly lock = createMutexLock();

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock('tx', fn);
  }

  async getItem(id: string) {
    return this.items.get(id);
  }
  async listItems() {
    return [...this.items.values()];
  }
  async putItem(item: LocalItem) {
    this.items.set(item.id, { ...item });
  }
  async updateItem(id: string, patch: Partial<LocalItem>) {
    const cur = this.items.get(id);
    if (cur) this.items.set(id, { ...cur, ...patch });
  }
  async deleteItems(ids: string[]) {
    for (const id of ids) this.items.delete(id);
  }

  async getVault(id: string) {
    return this.vaults.get(id);
  }
  async listVaults() {
    return [...this.vaults.values()];
  }
  async putVault(v: LocalVault) {
    this.vaults.set(v.id, { ...v });
  }
  async updateVault(id: string, patch: Partial<LocalVault>) {
    const cur = this.vaults.get(id);
    if (cur) this.vaults.set(id, { ...cur, ...patch });
  }

  async listOutbox() {
    return this.outbox.map((o) => ({ ...o }));
  }
  async getOutbox(seq: number) {
    return this.outbox.find((o) => o.seq === seq);
  }
  async findOutbox(kind: OutboxOp['kind'], id: string) {
    return this.outbox.find((o) => o.kind === kind && o.id === id);
  }
  async addOutbox(op: Omit<OutboxOp, 'seq'>) {
    this.outbox.push({ ...op, seq: ++this.seq });
  }
  async updateOutbox(seq: number, patch: Partial<OutboxOp>) {
    const o = this.outbox.find((x) => x.seq === seq);
    if (o) Object.assign(o, patch);
  }
  async deleteOutbox(seq: number) {
    this.outbox = this.outbox.filter((o) => o.seq !== seq);
  }

  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
  async clearAll() {
    this.items.clear();
    this.vaults.clear();
    this.outbox = [];
    this.meta.clear();
  }
}
