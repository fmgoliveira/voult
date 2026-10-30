/** Fan-out of "rev changed" notifications to connected sockets (ciphertext never travels here). */
export type Send = (msg: string) => void;

export class Hub {
  private readonly sockets = new Map<string, Set<Send>>();

  add(userId: string, send: Send): () => void {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(send);
    return () => {
      set.delete(send);
      if (set.size === 0) this.sockets.delete(userId);
    };
  }

  notify(userId: string, rev: number): void {
    const msg = JSON.stringify({ type: 'rev', rev });
    for (const send of this.sockets.get(userId) ?? []) {
      try {
        send(msg);
      } catch {
        /* dead socket; removed on close */
      }
    }
  }

  count(userId: string): number {
    return this.sockets.get(userId)?.size ?? 0;
  }
}
