import { browser } from 'wxt/browser';
import { getAccessToken, hasTokens, SignedOutError } from '../lib/api';
import { db } from '../lib/db';
import { getLastActivity, isUnlocked, shouldAutoLock } from '../lib/session';
import { getSettings } from '../lib/settings';
import { syncOnce } from '../lib/sync';
import { lock } from '../lib/vault';

export default defineBackground(() => {
  let syncing: Promise<unknown> | null = null;
  let again = false;
  let socket: WebSocket | null = null;

  /** Coalesces bursts of sync requests into at most one extra run. */
  async function runSync() {
    if (syncing) {
      again = true;
      return;
    }
    if (!(await db.getAccount()) || !(await hasTokens())) return;
    syncing = syncOnce()
      .catch((e) => {
        if (!(e instanceof SignedOutError)) console.warn('sync failed');
      })
      .finally(() => {
        syncing = null;
        if (again) {
          again = false;
          void runSync();
        }
      });
  }

  async function ensureSocket() {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    if (!(await hasTokens())) return;
    try {
      const { token, serverUrl } = await getAccessToken();
      const ws = new WebSocket(serverUrl.replace(/^http/, 'ws') + '/ws');
      socket = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (e) => {
        if (JSON.parse(String(e.data)).type === 'rev') void runSync();
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
      };
      ws.onerror = () => ws.close();
    } catch {
      socket = null;
    }
  }

  async function clearClipboard() {
    try {
      if (browser.offscreen) {
        await browser.offscreen
          .createDocument({
            url: 'offscreen.html',
            reasons: ['CLIPBOARD'] as never,
            justification: 'Clear copied secrets from the clipboard',
          })
          .catch(() => undefined);
        await browser.runtime.sendMessage({ type: 'offscreen-clear' });
      } else {
        await navigator.clipboard.writeText('');
      }
    } catch {
      /* best effort */
    }
  }

  browser.runtime.onMessage.addListener((msg: { type?: string; afterSeconds?: number }) => {
    if (msg?.type === 'sync') {
      void ensureSocket();
      void runSync();
    }
    if (msg?.type === 'schedule-clipboard-clear' && msg.afterSeconds) {
      void browser.alarms.create('clipboard-clear', { when: Date.now() + msg.afterSeconds * 1000 });
    }
    return undefined;
  });

  browser.alarms.create('tick', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'clipboard-clear') return clearClipboard();
    if (alarm.name !== 'tick') return;
    const { autoLockMinutes } = await getSettings();
    if (
      (await isUnlocked()) &&
      shouldAutoLock(Date.now(), await getLastActivity(), autoLockMinutes)
    ) {
      await lock();
    }
    void ensureSocket();
    void runSync();
  });

  // Lock when the OS screen locks.
  browser.idle?.onStateChanged.addListener((state) => {
    if (state === 'locked') void lock();
  });

  void ensureSocket();
  void runSync();
});
