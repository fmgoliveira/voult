import { browser } from 'wxt/browser';

/** The toolbar popup closes as soon as a native file dialog opens, so it cannot pick files. */
export function inToolbarPopup(): boolean {
  try {
    return browser.extension.getViews({ type: 'popup' }).includes(window);
  } catch {
    return false;
  }
}

export async function openInWindow() {
  await browser.windows.create({
    url: browser.runtime.getURL('/popup.html?mode=window' as never),
    type: 'popup',
    width: 420,
    height: 680,
  });
  window.close();
}
