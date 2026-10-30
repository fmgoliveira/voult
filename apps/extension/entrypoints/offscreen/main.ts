import { browser } from 'wxt/browser';

// Chrome service workers cannot touch the clipboard; this hidden page empties it on request.
browser.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type !== 'offscreen-clear') return;
  const t = document.getElementById('t') as HTMLTextAreaElement;
  t.value = ' ';
  t.select();
  document.execCommand('copy');
  t.value = '';
});
