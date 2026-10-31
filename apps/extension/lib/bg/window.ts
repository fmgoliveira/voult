import { browser } from 'wxt/browser';
import { getSettings, watchSettings } from '../settings';

const WIDTH = 420;
const HEIGHT = 680;
let windowId: number | undefined;

/**
 * A toolbar popup always hangs off the toolbar button, so "centred" means opening the same UI in
 * a small popup-type window in the middle of the current window instead.
 */
async function openCentered() {
  if (windowId !== undefined) {
    try {
      await browser.windows.update(windowId, { focused: true });
      return;
    } catch {
      windowId = undefined;
    }
  }
  const base = await browser.windows.getLastFocused().catch(() => undefined);
  const left = base?.left !== undefined && base.width ? base.left + (base.width - WIDTH) / 2 : 200;
  const top = base?.top !== undefined && base.height ? base.top + (base.height - HEIGHT) / 2 : 80;
  const w = await browser.windows.create({
    url: browser.runtime.getURL('/popup.html?mode=window' as never),
    type: 'popup',
    width: WIDTH,
    height: HEIGHT,
    left: Math.max(0, Math.round(left)),
    top: Math.max(0, Math.round(top)),
  });
  windowId = w?.id;
}

async function apply(centered: boolean) {
  // An empty popup makes the toolbar button fire `action.onClicked` instead of opening the popup.
  await browser.action.setPopup({ popup: centered ? '' : 'popup.html' });
}

export function setupPopupMode() {
  void getSettings().then((s) => apply(s.centeredWindow));
  watchSettings((s) => void apply(s.centeredWindow));
  browser.action.onClicked.addListener(() => void openCentered());
  browser.windows.onRemoved.addListener((id) => {
    if (id === windowId) windowId = undefined;
  });
}
