import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';
import { toBase64Url, utf8 } from '../crypto/bytes';
import { deriveLogin, unlockAccountKey, unlockWithRecovery } from '../crypto/keys';
import { decryptItem, openVault } from '../vault/ops';
import type { Item, VaultMeta } from '../vault/schemas';
import { toCsv } from './csv';

const kdfSchema = z.object({ m: z.number(), t: z.number(), p: z.number() });

/**
 * Self-contained encrypted snapshot (.voult file and Drive backup): KDF params,
 * wrapped keys and encrypted items. The master password alone restores it.
 */
export const snapshotSchema = z.object({
  format: z.literal('voult-snapshot'),
  version: z.literal(1),
  createdAt: z.number().int(),
  /** Account email, so a fresh install can recreate the account. Absent in older exports. */
  email: z.string().optional(),
  kdfParams: kdfSchema,
  salt: z.string(),
  wrappedAccountKey: z.string(),
  wrappedRecoveryKey: z.string(),
  vaults: z.array(
    z.object({
      id: z.string(),
      wrappedVaultKey: z.string(),
      encMeta: z.string(),
      deletedAt: z.number().int().nullable().default(null),
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      vaultId: z.string(),
      type: z.string(),
      wrappedItemKey: z.string(),
      ciphertext: z.string(),
      /** Client-chosen item version, bound into the AAD. */
      version: z.number().int().positive(),
      rev: z.number().int(),
      updatedAt: z.number().int(),
      deletedAt: z.number().int().nullable().default(null),
    }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export function serializeSnapshot(s: Snapshot): string {
  return JSON.stringify(snapshotSchema.parse(s));
}

export function parseSnapshot(text: string): Snapshot {
  return snapshotSchema.parse(JSON.parse(text));
}

/** Integrity checksum over the encrypted contents (order independent). */
export function snapshotChecksum(s: Snapshot): string {
  // Fixed field order so parsing/re-serialising never changes the checksum.
  const canon = JSON.stringify([
    s.vaults
      .map((v) => [v.id, v.wrappedVaultKey, v.encMeta, v.deletedAt])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    s.items
      .map((i) => [
        i.id,
        i.vaultId,
        i.type,
        i.wrappedItemKey,
        i.ciphertext,
        i.version,
        i.rev,
        i.deletedAt,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
  return toBase64Url(sha256(utf8(canon)));
}

export interface OpenedVault {
  id: string;
  meta: VaultMeta;
  items: { id: string; rev: number; deletedAt: number | null; item: Item }[];
}

export interface OpenedSnapshot {
  vaults: OpenedVault[];
  counts: { items: number; totp: number; passkeys: number };
}

/** Unlock a snapshot with the master password, or with the recovery secret key. */
export async function openSnapshot(
  snapshot: Snapshot,
  credential: { masterPassword: string } | { recoverySecret: string },
): Promise<OpenedSnapshot> {
  const accountKey =
    'masterPassword' in credential
      ? unlockAccountKey(
          (await deriveLogin(credential.masterPassword, snapshot.salt, snapshot.kdfParams)).kek,
          snapshot.wrappedAccountKey,
        )
      : unlockWithRecovery(credential.recoverySecret, snapshot.wrappedRecoveryKey);

  return openSnapshotWithKey(snapshot, accountKey);
}

/** Decrypt a snapshot with an already unlocked account key. */
export function openSnapshotWithKey(snapshot: Snapshot, accountKey: Uint8Array): OpenedSnapshot {
  const counts = { items: 0, totp: 0, passkeys: 0 };
  const vaults = snapshot.vaults.map((v) => {
    const { vaultKey, meta } = openVault(accountKey, v);
    const items = snapshot.items
      .filter((i) => i.vaultId === v.id)
      .map((i) => {
        const item = decryptItem(vaultKey, i.id, i.version, i);
        counts.items++;
        if (item.type === 'totp' || (item.type === 'login' && item.totp)) counts.totp++;
        if (item.type === 'login') counts.passkeys += item.passkeys.length;
        return { id: i.id, rev: i.rev, deletedAt: i.deletedAt, item };
      });
    return { id: v.id, meta, items };
  });
  return { vaults, counts };
}

/** Plaintext JSON export. Callers must warn the user first. */
export function exportJson(opened: OpenedSnapshot): string {
  return JSON.stringify(
    {
      format: 'voult-plaintext',
      version: 1,
      vaults: opened.vaults.map((v) => ({
        name: v.meta.name,
        items: v.items.filter((i) => !i.deletedAt).map((i) => i.item),
      })),
    },
    null,
    2,
  );
}

/** Plaintext CSV of login items (Chrome-compatible columns plus otpauth). */
export function exportCsv(opened: OpenedSnapshot): string {
  const rows = [['name', 'url', 'username', 'password', 'note', 'totp', 'vault']];
  for (const v of opened.vaults) {
    for (const { item, deletedAt } of v.items) {
      if (deletedAt || item.type !== 'login') continue;
      rows.push([
        item.title,
        item.urls[0]?.url ?? '',
        item.username || item.email,
        item.password,
        item.notes,
        item.totp?.secret ?? '',
        v.meta.name,
      ]);
    }
  }
  return toCsv(rows);
}
