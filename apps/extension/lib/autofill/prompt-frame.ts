import { browser } from 'wxt/browser';

/**
 * Shows the extension's passkey prompt on top of the page as a centred modal, instead of opening a
 * separate browser window. The prompt itself is an extension page in an iframe, so the page can
 * neither read it nor script it; only the dimmed backdrop (outside the iframe) is ours to handle.
 */
export class PromptFrame {
  private host: HTMLElement | null = null;

  show(id: string, onDismiss: () => void): void {
    this.hide();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });

    const scrim = document.createElement('div');
    scrim.style.cssText =
      'position:fixed;inset:0;background:rgba(2,6,18,.5);display:flex;align-items:center;justify-content:center;';
    scrim.addEventListener('click', (e) => {
      if (e.isTrusted && e.target === scrim) onDismiss();
    });

    const frame = document.createElement('iframe');
    frame.title = 'Voult';
    frame.src = browser.runtime.getURL(`/prompt.html?id=${id}&embed=1` as never);
    frame.style.cssText =
      'width:min(380px,calc(100vw - 24px));height:min(540px,calc(100vh - 24px));border:0;' +
      'border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.5);background:#fff;color-scheme:light dark;';

    scrim.append(frame);
    root.append(scrim);
    document.documentElement.append(host);
    this.host = host;
    // Keyboard focus into the prompt once it exists (so Escape and Tab work straight away).
    frame.addEventListener('load', () => {
      frame.focus();
      frame.contentWindow?.focus();
    });
    frame.focus();
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
  }
}
