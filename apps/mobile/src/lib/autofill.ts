import { buildAutofillIndex, type ItemView, type LoginItem } from '@voult/core';
import * as Native from '../../modules/voult-native';

let lastIndex = '';

/** Keeps the autofill service's on-device index in step with the vault (labels and match keys only). */
export async function syncAutofillIndex(items: ItemView[]): Promise<void> {
  const json = JSON.stringify(buildAutofillIndex(items));
  if (json === lastIndex) return;
  try {
    await Native.setAutofillIndex(json);
    lastIndex = json;
  } catch {
    // Autofill just keeps the previous index; nothing to tell the user.
  }
}

/** Signing out removes everything autofill knew. */
export function clearAutofillIndex(): void {
  lastIndex = '';
  try {
    Native.clearAutofillData();
  } catch {
    /* module unavailable (tests) */
  }
}

/** Values to pre-fill the "new login" form with (from the autofill save prompt). */
export interface DraftSeed {
  title: string;
  username: string;
  password: string;
  urls: LoginItem['urls'];
}

// Kept in memory only, so the password never travels through route params.
let seed: DraftSeed | null = null;
export const setDraftSeed = (s: DraftSeed) => void (seed = s);
export function takeDraftSeed(): DraftSeed | null {
  const s = seed;
  seed = null;
  return s;
}
