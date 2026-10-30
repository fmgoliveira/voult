import { storage } from 'wxt/utils/storage';

export interface Settings {
  serverUrl: string;
  /** 0 = never (browser close still locks). */
  autoLockMinutes: number;
  /** 0 = never. */
  clipboardClearSeconds: number;
  theme: 'system' | 'light' | 'dark';
  /** Offer a memory-only PIN for quick unlock. */
  pinEnabled: boolean;
  autofillEnabled: boolean;
  /** Hosts for which the save/update prompt is never shown. */
  neverSave: string[];
  passkeysEnabled: boolean;
  /** rpIds / hosts where Voult must not intercept passkey requests. */
  passkeyOptOut: string[];
}

export const DEFAULT_SERVER_URL = 'https://voult.franciscoliveira.com';

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: DEFAULT_SERVER_URL,
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
  theme: 'system',
  pinEnabled: false,
  autofillEnabled: true,
  neverSave: [],
  passkeysEnabled: true,
  passkeyOptOut: [],
};

const item = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await item.getValue()) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await item.setValue(next);
  return next;
}

export const watchSettings = (cb: (s: Settings) => void) =>
  item.watch((v) => cb({ ...DEFAULT_SETTINGS, ...v }));

export const normalizeServerUrl = (url: string): string => {
  const u = new URL(url.trim());
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
    throw new Error('Server URL must use https');
  }
  return u.origin;
};
