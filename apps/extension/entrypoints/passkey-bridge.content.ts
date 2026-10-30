import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { ContentRequest } from '../lib/autofill/messages';

/**
 * Isolated-world relay for the MAIN-world WebAuthn hook. It runs at document_start so a page
 * that calls navigator.credentials immediately never talks to a missing listener.
 * The page can only reach it through a MessageChannel it created, and anything it can ask here
 * it could already ask the browser's own WebAuthn implementation.
 */
export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  allFrames: true,
  runAt: 'document_start',
  main() {
    addEventListener('message', (e) => {
      if (e.source !== window || e.data?.__voult !== 'passkey' || !e.ports[0]) return;
      const port = e.ports[0];
      const msg = e.data.msg as ContentRequest;
      if (msg?.type !== 'passkey:create' && msg?.type !== 'passkey:get') {
        port.postMessage({ status: 'fallback' });
        return;
      }
      browser.runtime
        .sendMessage(msg)
        .then((res) => port.postMessage(res ?? { status: 'fallback' }))
        .catch(() => port.postMessage({ status: 'fallback' }));
    });
  },
});
