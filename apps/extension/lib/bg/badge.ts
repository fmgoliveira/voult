import { matchLogin, type LoginItem } from '@voult/core';
import { browser } from 'wxt/browser';
import { isUnlocked } from '../session';
import { getVaultData, liveLogins, setInvalidateListener } from './items';

const label = (n: number) => (n === 0 ? '' : n > 99 ? '99+' : String(n));

/**
 * Puts the number of logins matching each window's active tab on the toolbar icon. Nothing is
 * shown while the vault is locked (matching needs the decrypted URLs) or when there are none.
 */
export async function refreshBadge(): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, windowType: 'normal' }).catch(() => []);
  const unlocked = await isUnlocked();
  const data = unlocked ? await getVaultData() : null;
  const logins = data ? liveLogins(data.items) : [];
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const url = tab.url ?? '';
    const count = /^https?:/.test(url)
      ? logins.filter((v) => matchLogin(v.item as LoginItem, url)).length
      : 0;
    void browser.action.setBadgeText({ tabId: tab.id, text: label(count) }).catch(() => undefined);
  }
}

export function setupBadge(): void {
  void browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
  void browser.action.setBadgeTextColor?.({ color: '#ffffff' });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refreshBadge(), 150);
  };
  setInvalidateListener(schedule);
  browser.tabs.onActivated.addListener(schedule);
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (change.url || change.status === 'complete') schedule();
  });
  browser.windows.onFocusChanged.addListener(schedule);
  schedule();
}

/** Called by the minute tick: clears the badge after an auto-lock without decrypting anything. */
export async function clearBadgeIfLocked(): Promise<void> {
  if (!(await isUnlocked())) await refreshBadge();
}
