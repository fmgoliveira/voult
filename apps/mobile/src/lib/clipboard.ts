import { ToastAndroid } from 'react-native';
import * as Native from '../../modules/voult-native';
import { noteClipboardClear, useApp } from './app-store';

/** Copy flagged as sensitive (hidden from clipboard previews) and schedule the auto-clear. */
export function copySecret(text: string, what = 'Copied'): void {
  const seconds = useApp.getState().settings.clipboardClearSeconds;
  Native.copySensitive(text, seconds);
  noteClipboardClear(seconds);
  ToastAndroid.show(seconds > 0 ? `${what} · clears in ${seconds}s` : what, ToastAndroid.SHORT);
}
