import { browser } from 'wxt/browser';

/**
 * Shows the extension's passkey prompt on top of the page as a card in the top-right corner (like the browser's own passkey dialog), instead of opening a
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
      'position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:flex-end;padding:12px;box-sizing:border-box;';
    scrim.addEventListener('click', (e) => {
      if (e.isTrusted && e.target === scrim) onDismiss();
    });

    const frame = document.createElement('iframe');
    frame.title = 'Voult';
    frame.src = browser.runtime.getURL(`/prompt.html?id=${id}&embed=1` as never);
    // The wrapper owns the rounded corners and shadow and clips the iframe; a bare inline iframe
    // leaves a baseline gap below it and shows its backdrop at the rounded edges.
    const card = document.createElement('div');
    card.style.cssText =
      'width:min(380px,calc(100vw - 24px));height:min(540px,calc(100vh - 24px));overflow:hidden;' +
      'border-radius:18px;box-shadow:0 0 0 1px rgba(128,128,128,.28),0 18px 50px rgba(0,0,0,.4);';
    frame.style.cssText =
      'display:block;width:100%;height:100%;border:0;margin:0;padding:0;color-scheme:light dark;';
    card.append(frame);

    scrim.append(card);
    root.append(scrim);
    document.documentElement.append(host);
    this.host = host;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      card.animate(
        [
          { opacity: 0, transform: 'translate(10px,-10px) scale(.97)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 240, easing: 'cubic-bezier(.2,.9,.3,1.1)' },
      );
    }
    // Keyboard focus into the prompt once it exists (so Escape and Tab work straight away).
    frame.addEventListener('load', () => {
      frame.focus();
      frame.contentWindow?.focus();
    });
    frame.focus();
  }

  hide(): void {
    const host = this.host;
    this.host = null;
    if (!host) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return host.remove();
    host
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in' })
      .finished.then(() => host.remove())
      .catch(() => host.remove());
  }
}
