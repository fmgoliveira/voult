import { MemoryStore, type LocalItem, type LocalVault, type OutboxOp } from '@voult/core';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The local copy of the vault: encrypted blobs the server already holds plus the sync outbox,
 * kept in memory and persisted to a JSON file. Nothing in it opens without the master password.
 */
export class FileStore extends MemoryStore {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;

  constructor(private readonly file: string) {
    super();
    if (existsSync(file)) {
      try {
        this.importState(JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        /* a corrupt cache is rebuilt by the next sync */
      }
    }
  }

  private schedule(): void {
    this.pending = true;
    this.timer ??= setTimeout(() => this.flush(), 200);
    this.timer.unref?.();
  }

  /** Write now (atomically). Called on exit and by tests. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return;
    this.pending = false;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.exportState()));
    renameSync(tmp, this.file);
  }

  override async putItem(item: LocalItem) {
    await super.putItem(item);
    this.schedule();
  }
  override async updateItem(id: string, patch: Partial<LocalItem>) {
    await super.updateItem(id, patch);
    this.schedule();
  }
  override async deleteItems(ids: string[]) {
    await super.deleteItems(ids);
    this.schedule();
  }
  override async putVault(v: LocalVault) {
    await super.putVault(v);
    this.schedule();
  }
  override async updateVault(id: string, patch: Partial<LocalVault>) {
    await super.updateVault(id, patch);
    this.schedule();
  }
  override async addOutbox(op: Omit<OutboxOp, 'seq'>) {
    await super.addOutbox(op);
    this.schedule();
  }
  override async updateOutbox(seq: number, patch: Partial<OutboxOp>) {
    await super.updateOutbox(seq, patch);
    this.schedule();
  }
  override async deleteOutbox(seq: number) {
    await super.deleteOutbox(seq);
    this.schedule();
  }
  override async setMeta(key: string, value: unknown) {
    await super.setMeta(key, value);
    this.schedule();
  }
  override async clearAll() {
    await super.clearAll();
    this.schedule();
  }
}
