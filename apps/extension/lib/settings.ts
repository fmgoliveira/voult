import type { LangSetting } from '@voult/core';
import { storage } from 'wxt/utils/storage';

export interface Settings {
  serverUrl: string;
  /** 0 = never (browser close still locks). */
  autoLockMinutes: number;
  /** 0 = never. */
  clipboardClearSeconds: number;
  theme: 'system' | 'light' | 'dark';
  language: LangSetting;
  /** Offer a memory-only PIN for quick unlock. */
  pinEnabled: boolean;
  autofillEnabled: boolean;
  /** Hosts for which the save/update prompt is never shown. */
  neverSave: string[];
  passkeysEnabled: boolean;
  /** rpIds / hosts where Voult must not intercept passkey requests. */
  passkeyOptOut: string[];
  /** Fetch each website's own icon for logins (no third party involved). */
  showIcons: boolean;
  /** Open Voult in a window centred on screen instead of the toolbar popup. */
  centeredWindow: boolean;
}

export const DEFAULT_SERVER_URL = 'https://voult.franciscoliveira.com';

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: DEFAULT_SERVER_URL,
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
  theme: 'system',
  language: 'system',
  pinEnabled: false,
  autofillEnabled: true,
  neverSave: [],
  passkeysEnabled: true,
  passkeyOptOut: [],
  showIcons: true,
  centeredWindow: false,
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

export { normalizeServerUrl } from '@voult/core';
