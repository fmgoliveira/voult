import type { ItemView } from '../client/types';
import { SSH_ALIAS_RE, type SshHostItem, type SshKeyItem, type SshKeyType } from '../vault/schemas';

export type AliasError = 'empty' | 'invalid' | 'duplicate';

/** Aliases already used by the account's (non-trashed) ssh hosts, optionally skipping one item. */
export function takenAliases(items: ItemView[], exceptId?: string): string[] {
  return items
    .filter((v) => v.item.type === 'sshHost' && v.id !== exceptId && v.deletedAt === null)
    .map((v) => (v.item as SshHostItem).alias);
}

/**
 * Check a `Host` alias: non-empty, only `[A-Za-z0-9._-]`, not starting with `-` (ssh would read it
 * as an option) and unique among `taken`.
 */
export function validateAlias(alias: string, taken: Iterable<string>): AliasError | null {
  if (!alias) return 'empty';
  if (!SSH_ALIAS_RE.test(alias) || alias.startsWith('-')) return 'invalid';
  for (const t of taken) if (t === alias) return 'duplicate';
  return null;
}

/** `ssh user@host -p port`, as you would type it. */
export function sshCommand(h: Pick<SshHostItem, 'hostname' | 'username' | 'port'>): string {
  const target = h.username ? `${h.username}@${h.hostname}` : h.hostname;
  return h.port === 22 ? `ssh ${target}` : `ssh ${target} -p ${h.port}`;
}

/** Suggested file name when saving a private key. */
export function sshKeyFilename(keyType: SshKeyType): string {
  return keyType === 'ed25519' ? 'id_ed25519' : keyType === 'rsa' ? 'id_rsa' : 'id_ecdsa';
}

/** The sshKey items a host can point at (live, not trashed). */
export function sshKeyChoices(items: ItemView[]): (ItemView & { item: SshKeyItem })[] {
  return items.filter(
    (v): v is ItemView & { item: SshKeyItem } => v.item.type === 'sshKey' && v.deletedAt === null,
  );
}

export const hostUsesKey = (h: Pick<SshHostItem, 'auth'>): boolean => h.auth !== 'password';
export const hostUsesPassword = (h: Pick<SshHostItem, 'auth'>): boolean => h.auth !== 'key';

const ALIAS_MESSAGE: Record<AliasError, string> = {
  empty: 'Enter an alias, the short name you type after ssh.',
  invalid: 'Use only letters, digits, dot, dash and underscore (no leading dash).',
  duplicate: 'Another host already uses this alias.',
};
export const aliasMessage = (e: AliasError): string => ALIAS_MESSAGE[e];

/** The first reason an ssh key/host draft cannot be saved, or null when it is fine. */
export function sshDraftProblem(
  draft: SshKeyItem | SshHostItem,
  items: ItemView[],
  selfId?: string,
): string | null {
  if (draft.type === 'sshKey') {
    return draft.privateKey ? null : 'Generate or import a private key first.';
  }
  const alias = validateAlias(draft.alias, takenAliases(items, selfId));
  if (alias) return aliasMessage(alias);
  if (!draft.hostname.trim()) return 'Enter the host name or address.';
  if (hostUsesKey(draft) && !draft.keyItemId) return 'Choose which key this host uses.';
  return null;
}
