import { open, seal } from '../crypto/aead';
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from '../crypto/bytes';
import { newKey, unwrapKey, wrapKey } from '../crypto/keys';
import {
  itemSchema,
  PASSWORD_HISTORY_LIMIT,
  vaultMetaSchema,
  type Item,
  type LoginItem,
  type VaultMeta,
} from './schemas';

export interface VaultRecord {
  id: string;
  wrappedVaultKey: string;
  /** Vault metadata (name, colour, icon) encrypted with the vault key. */
  encMeta: string;
}

export interface ItemRecord {
  id: string;
  vaultId: string;
  type: Item['type'];
  wrappedItemKey: string;
  ciphertext: string;
  rev: number;
}

const vaultKeyCtx = (id: string) => `voult:vault-key:${id}`;
const vaultMetaCtx = (id: string) => `voult:vault-meta:${id}`;
const itemCtx = (id: string, version: number) => `voult:item:${id}:${version}`;

export const newId = (): string => crypto.randomUUID();

export function createVault(
  accountKey: Uint8Array,
  meta: Partial<VaultMeta> & { name: string },
  id: string = newId(),
): { record: VaultRecord; vaultKey: Uint8Array } {
  const vaultKey = newKey();
  const parsed = vaultMetaSchema.parse(meta);
  return {
    vaultKey,
    record: {
      id,
      wrappedVaultKey: wrapKey(accountKey, vaultKey, vaultKeyCtx(id)),
      encMeta: toBase64Url(seal(vaultKey, utf8(JSON.stringify(parsed)), vaultMetaCtx(id))),
    },
  };
}

export function openVault(
  accountKey: Uint8Array,
  record: VaultRecord,
): { vaultKey: Uint8Array; meta: VaultMeta } {
  const vaultKey = unwrapKey(accountKey, record.wrappedVaultKey, vaultKeyCtx(record.id));
  const json = fromUtf8(open(vaultKey, fromBase64Url(record.encMeta), vaultMetaCtx(record.id)));
  return { vaultKey, meta: vaultMetaSchema.parse(JSON.parse(json)) };
}

/**
 * Encrypt an item with a fresh per-item key (wrapped by the vault key).
 * The item id and version are bound as AAD so records cannot be swapped or rolled back.
 */
export function encryptItem(
  vaultKey: Uint8Array,
  id: string,
  version: number,
  item: Item,
): { wrappedItemKey: string; ciphertext: string } {
  const itemKey = newKey();
  const aad = itemCtx(id, version);
  return {
    wrappedItemKey: wrapKey(vaultKey, itemKey, aad),
    ciphertext: toBase64Url(seal(itemKey, utf8(JSON.stringify(itemSchema.parse(item))), aad)),
  };
}

export function decryptItem(
  vaultKey: Uint8Array,
  id: string,
  version: number,
  rec: { wrappedItemKey: string; ciphertext: string },
): Item {
  const aad = itemCtx(id, version);
  const itemKey = unwrapKey(vaultKey, rec.wrappedItemKey, aad);
  const json = fromUtf8(open(itemKey, fromBase64Url(rec.ciphertext), aad));
  return itemSchema.parse(JSON.parse(json));
}

/** Push a replaced password into history (newest first, capped at 10). */
export function pushPasswordHistory(
  history: LoginItem['passwordHistory'],
  oldPassword: string,
  at: number,
): LoginItem['passwordHistory'] {
  if (!oldPassword) return history;
  return [{ password: oldPassword, changedAt: at }, ...history].slice(0, PASSWORD_HISTORY_LIMIT);
}

/** Apply an edit to a login, recording the previous password in history when it changed. */
export function updateLogin(prev: LoginItem, patch: Partial<LoginItem>, now: number): LoginItem {
  const next: LoginItem = { ...prev, ...patch, updatedAt: now };
  if (patch.password !== undefined && patch.password !== prev.password) {
    next.passwordHistory = pushPasswordHistory(prev.passwordHistory, prev.password, now);
  }
  return next;
}

/**
 * Resolve a 409: last writer wins on everything; if the passwords differ the losing
 * password is kept in history so nothing is lost.
 */
export function resolveConflict(local: Item, remote: Item): Item {
  const winner = local.updatedAt >= remote.updatedAt ? local : remote;
  const loser = winner === local ? remote : local;
  if (winner.type === 'login' && loser.type === 'login' && winner.password !== loser.password) {
    return {
      ...winner,
      passwordHistory: pushPasswordHistory(
        winner.passwordHistory,
        loser.password,
        loser.updatedAt,
      ),
    };
  }
  return winner;
}

/** Soft-delete helpers: trash purge window is 30 days. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const isPurgeable = (deletedAt: number, now: number): boolean =>
  now - deletedAt >= TRASH_RETENTION_MS;
