import { browser } from 'wxt/browser';
import { useToast } from '../components/ui';
import { getSettings } from './settings';

/** Copy text and ask the background worker to clear the clipboard after the configured delay. */
export async function copySecret(text: string, what = 'Copied'): Promise<void> {
  await navigator.clipboard.writeText(text);
  const { clipboardClearSeconds } = await getSettings();
  useToast
    .getState()
    .show(clipboardClearSeconds > 0 ? `${what} · clears in ${clipboardClearSeconds}s` : what);
  if (clipboardClearSeconds > 0) {
    browser.runtime
      .sendMessage({ type: 'schedule-clipboard-clear', afterSeconds: clipboardClearSeconds })
      .catch(() => undefined);
  }
}
