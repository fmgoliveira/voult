import { browser } from 'wxt/browser';
import { getAccessToken, hasTokens, SignedOutError } from '../lib/api';
import { db } from '../lib/db';
import { getLastActivity, isUnlocked, shouldAutoLock } from '../lib/session';
import { getSettings } from '../lib/settings';
import { syncOnce } from '../lib/sync';
import { lock } from '../lib/vault';
import {
  handleAccept,
  handleDismiss,
  handleFill,
  handleGenerate,
  handleOtp,
  handlePoll,
  handleQuery,
  handleSubmit,
} from '../lib/bg/autofill';
import { invalidateItems } from '../lib/bg/items';
import {
  decidePrompt,
  getPromptRequest,
  handlePasskeyCreate,
  handlePasskeyGet,
  watchPromptWindows,
} from '../lib/bg/passkeys';
import type { ContentRequest } from '../lib/autofill/messages';
import type { PromptMessage } from '../lib/bg/prompt-types';
import type { Sender } from '../lib/bg/types';
import { setupPopupMode } from '../lib/bg/window';

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
        invalidateItems();
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

  const isExtensionPage = (sender: { url?: string }) =>
    !!sender.url?.startsWith(browser.runtime.getURL('/' as never).replace(/\/$/, ''));

  async function route(msg: ContentRequest | PromptMessage, sender: Sender): Promise<unknown> {
    switch (msg.type) {
      case 'autofill:query':
        return handleQuery(sender);
      case 'autofill:fill':
        return handleFill(sender, msg.id);
      case 'autofill:otp':
        return handleOtp(sender);
      case 'autofill:generate':
        return handleGenerate();
      case 'capture:submit': {
        await handleSubmit(sender, msg);
        const tabId = sender.tab?.id;
        // Let the top frame show the prompt even when the login form lives in an iframe.
        if (tabId !== undefined) {
          setTimeout(() => {
            void browser.tabs
              .sendMessage(tabId, { type: 'capture:show' }, { frameId: 0 })
              .catch(() => undefined);
          }, 900);
        }
        return null;
      }
      case 'capture:poll':
        return handlePoll(sender);
      case 'capture:accept':
        return handleAccept(sender);
      case 'capture:dismiss':
        return handleDismiss(sender, msg.never);
      case 'passkey:create':
        return handlePasskeyCreate(sender, msg.options);
      case 'passkey:get':
        return handlePasskeyGet(sender, msg.options);
      case 'prompt:get':
        return isExtensionPage(sender) ? getPromptRequest(msg.id) : null;
      case 'prompt:decide':
        if (isExtensionPage(sender)) decidePrompt(msg.id, msg.decision);
        return null;
    }
  }

  const ROUTED = /^(autofill|capture|passkey|prompt):/;
  browser.runtime.onMessage.addListener(
    (msg: { type?: string; afterSeconds?: number }, sender, sendResponse) => {
      if (msg?.type && ROUTED.test(msg.type)) {
        route(msg as ContentRequest | PromptMessage, sender).then(sendResponse, () =>
          sendResponse(null),
        );
        return true;
      }
      if (msg?.type === 'sync') {
        invalidateItems();
        void ensureSocket();
        void runSync();
      }
      if (msg?.type === 'schedule-clipboard-clear' && msg.afterSeconds) {
        void browser.alarms.create('clipboard-clear', {
          when: Date.now() + msg.afterSeconds * 1000,
        });
      }
      return undefined;
    },
  );
  watchPromptWindows();
  setupPopupMode();

  // Context menu + keyboard shortcut: ask the right frame(s) to run the autofill flow.
  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: 'voult-fill',
        title: 'Fill with Voult',
        contexts: ['editable'],
      });
      browser.contextMenus.create({
        id: 'voult-generate',
        title: 'Generate password with Voult',
        contexts: ['editable'],
      });
    });
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id === undefined) return;
    const type =
      info.menuItemId === 'voult-generate' ? 'autofill:generate-here' : 'autofill:trigger';
    void browser.tabs
      .sendMessage(
        tab.id,
        { type },
        info.frameId !== undefined ? { frameId: info.frameId } : undefined,
      )
      .catch(() => undefined);
  });
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'fill-login') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined)
      void browser.tabs.sendMessage(tab.id, { type: 'autofill:trigger' }).catch(() => undefined);
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
