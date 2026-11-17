import type { SshKeyType } from '@voult/core';

/** One key the agent may use, decrypted from the vault while it is unlocked. */
export interface AgentKey {
  itemId: string;
  title: string;
  keyType: SshKeyType;
  fingerprint: string;
  /** SSH wire-format public key blob (what the agent lists and clients ask to sign with). */
  blob: Uint8Array;
  /** Ask the user before every signature. */
  confirm: boolean;
  /** The unencrypted OpenSSH private key, as UTF-8 bytes so it can be zeroed. */
  privateKey: Uint8Array;
}

/**
 * The keys currently available to the agent. Held as byte arrays so `wipe()` can really
 * overwrite them when the vault locks (JavaScript strings cannot be erased).
 */
export class Keyring {
  private keys: AgentKey[] = [];

  /** Replace the contents, wiping what was there. */
  replace(keys: AgentKey[]): void {
    this.wipe();
    this.keys = keys;
  }

  list(): readonly AgentKey[] {
    return this.keys;
  }

  get size(): number {
    return this.keys.length;
  }

  find(blob: Uint8Array): AgentKey | undefined {
    return this.keys.find(
      (k) => k.blob.length === blob.length && k.blob.every((b, i) => b === blob[i]),
    );
  }

  /** Overwrite every private key buffer with zeros and forget the keys. */
  wipe(): void {
    for (const k of this.keys) {
      k.privateKey.fill(0);
      k.blob.fill(0);
    }
    this.keys = [];
  }
}
