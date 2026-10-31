export interface Settings {
  /** Minutes in the background before locking; 0 = immediately, -1 = only when the app is killed. */
  autoLockMinutes: number;
  /** 0 = never. */
  clipboardClearSeconds: number;
  theme: 'system' | 'light' | 'dark';
  /** FLAG_SECURE: block screenshots, screen recording and the recents thumbnail. */
  blockScreenshots: boolean;
  /** Fetch each website's own icon for logins (no third party involved). */
  showIcons: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
  theme: 'system',
  blockScreenshots: true,
  showIcons: true,
};

export const DEFAULT_SERVER_URL = 'https://voult.franciscoliveira.com';

/** Whether the app should lock after being away for `awayMs`. */
export function shouldLockAfterBackground(awayMs: number, minutes: number): boolean {
  if (minutes < 0) return false;
  return awayMs >= minutes * 60_000;
}
