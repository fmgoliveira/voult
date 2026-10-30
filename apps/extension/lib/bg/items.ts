import { isUnlocked } from '../session';
import { loadVault, type ItemView, type VaultView } from '../vault';

/**
 * Short-lived cache of decrypted items for the background worker, so the autofill dropdown
 * (NFR1: < 150 ms) does not decrypt the whole vault on every focus. It lives in worker memory
 * only and is dropped on lock, sync and local writes.
 */
let cache: { at: number; items: ItemView[]; vaults: VaultView[] } | null = null;
const TTL_MS = 60_000;

export function invalidateItems(): void {
  cache = null;
}

export async function getVaultData(): Promise<{ items: ItemView[]; vaults: VaultView[] } | null> {
  if (!(await isUnlocked())) {
    cache = null;
    return null;
  }
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  try {
    const data = await loadVault();
    cache = { at: Date.now(), ...data };
    return cache;
  } catch {
    return null;
  }
}

export const liveLogins = (items: ItemView[]) =>
  items.filter((v) => v.deletedAt === null && v.item.type === 'login');
