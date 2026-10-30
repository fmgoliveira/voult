import { browser } from 'wxt/browser';
import { getSettings } from './settings';

/** Copy text and ask the background worker to clear the clipboard after the configured delay. */
export async function copySecret(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  const { clipboardClearSeconds } = await getSettings();
  if (clipboardClearSeconds > 0) {
    browser.runtime
      .sendMessage({ type: 'schedule-clipboard-clear', afterSeconds: clipboardClearSeconds })
      .catch(() => undefined);
  }
}
