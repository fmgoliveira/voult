import { avatarGradient } from '@voult/ui-tokens';

/**
 * In-page UI (icon, dropdown, save prompt). Lives in a closed shadow root so page CSS cannot
 * restyle it and page scripts cannot read what it shows.
 */
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.icon { position: fixed; z-index: 2147483646; width: 24px; height: 24px; border: 0; padding: 0; cursor: pointer;
  border-radius: 8px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); display: none; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px -2px rgba(37, 99, 235, .5), inset 0 1px 0 rgba(255,255,255,.35); transition: transform .12s ease; }
.icon:hover { transform: scale(1.08); }
.icon svg { width: 15px; height: 15px; }
.menu { position: fixed; z-index: 2147483647; min-width: 250px; max-width: 340px; padding: 6px; font-size: 13px; color: #171a2b;
  background: rgba(255,255,255,.78); border: 1px solid rgba(120,110,200,.25); border-radius: 16px;
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%);
  box-shadow: 0 18px 44px -12px rgba(50,35,140,.4), inset 0 1px 0 rgba(255,255,255,.8);
  animation: pop .16s cubic-bezier(.2,.9,.3,1.2); }
.menu button { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; text-align: left;
  padding: 7px 8px; border-radius: 11px; cursor: pointer; color: inherit; font-size: 13px; }
.menu button:hover, .menu button:focus-visible, .menu button.active { background: rgba(37,99,235,.12); outline: none; }
.menu .avatar { flex: none; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: #fff;
  font-weight: 700; font-size: 13px; }
.menu .text { display: flex; flex-direction: column; min-width: 0; }
.menu .text span:first-child { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu small { color: #626982; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu .note { padding: 9px 10px; color: #626982; }
.unlock { position: fixed; z-index: 2147483647; width: 300px; height: 200px; border: 0; padding: 0;
  border-radius: 16px; background: transparent; color-scheme: light dark; box-shadow: 0 18px 44px -12px rgba(15,23,42,.45);
  animation: pop .16s cubic-bezier(.2,.9,.3,1.2); }
.bar { position: fixed; z-index: 2147483647; top: 14px; right: 14px; width: 340px; padding: 16px; font-size: 13px; color: #171a2b;
  background: rgba(255,255,255,.82); border: 1px solid rgba(120,110,200,.25); border-radius: 20px;
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 0 22px 54px -14px rgba(50,35,140,.45), inset 0 1px 0 rgba(255,255,255,.8);
  animation: slide .22s cubic-bezier(.2,.9,.3,1.1); }
.bar .head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.bar .head svg { width: 28px; height: 28px; flex: none; }
.bar h2 { margin: 0; font-size: 14px; font-weight: 700; }
.bar p { margin: 2px 0 14px; color: #626982; padding-left: 38px; }
.bar .row { display: flex; gap: 8px; flex-wrap: wrap; }
.bar button { height: 34px; padding: 0 14px; border-radius: 11px; border: 1px solid rgba(120,110,200,.25); background: rgba(255,255,255,.6);
  cursor: pointer; font-size: 13px; font-weight: 600; color: inherit; transition: transform .1s ease; }
.bar button:active { transform: scale(.96); }
.bar button.primary { background: linear-gradient(135deg, #3b82f6, #1d4ed8); border-color: transparent; color: #fff;
  box-shadow: 0 6px 16px -4px rgba(37,99,235,.5); }
@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.97); } }
@keyframes slide { from { opacity: 0; transform: translateY(-10px) scale(.97); } }
@media (prefers-reduced-motion: reduce) { .menu, .bar { animation: none; } }
@media (prefers-color-scheme: dark) {
  .menu, .bar { color: #f1f3ff; background: rgba(24,28,52,.78); border-color: rgba(160,170,255,.22);
    box-shadow: 0 22px 54px -14px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.07); }
  .menu button:hover, .menu button:focus-visible, .menu button.active { background: rgba(79,140,255,.2); }
  .menu small, .menu .note, .bar p { color: #9aa1c4; }
  .bar button { background: rgba(255,255,255,.07); border-color: rgba(160,170,255,.2); }
}
`;

const LOGO =
  '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 8.5 29.5 12v7.2c0 5.4-3.8 9.8-9.5 12.3-5.7-2.5-9.5-6.9-9.5-12.3V12L20 8.5Z" fill="rgba(255,255,255,.2)" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 20.5l3 3 5.5-6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BAR_LOGO =
  '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="40" height="40" rx="12" fill="url(#g)"/><path d="M20 8.5 29.5 12v7.2c0 5.4-3.8 9.8-9.5 12.3-5.7-2.5-9.5-6.9-9.5-12.3V12L20 8.5Z" fill="rgba(255,255,255,.2)" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 20.5l3 3 5.5-6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface MenuItem {
  label: string;
  detail?: string;
  onSelect: () => void;
}

export class InPageUi {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly icon: HTMLButtonElement;
  private menu: HTMLElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private entries: { button: HTMLButtonElement; select: () => void }[] = [];
  private activeIdx = -1;
  private bar: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private onIconClick: (() => void) | null = null;

  constructor() {
    this.host = document.createElement('voult-autofill');
    // Closed in production so page scripts cannot inspect the UI; open only in the e2e build.
    this.root = this.host.attachShadow({ mode: import.meta.env.WXT_E2E ? 'open' : 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.icon = document.createElement('button');
    this.icon.className = 'icon';
    this.icon.type = 'button';
    this.icon.title = 'Voult';
    this.icon.setAttribute('aria-label', 'Open Voult autofill');
    this.icon.innerHTML = LOGO;
    // mousedown would blur the field and hide us before click fires.
    this.icon.addEventListener('mousedown', (e) => e.preventDefault());
    this.icon.addEventListener('click', (e) => {
      if (!e.isTrusted) return; // scripted clicks must never trigger a fill
      e.preventDefault();
      e.stopPropagation();
      this.onIconClick?.();
    });
    this.root.append(style, this.icon);
    (document.documentElement || document.body).append(this.host);
  }

  /** Show the icon inside the right edge of a field. */
  showIcon(field: HTMLElement, onClick: () => void): void {
    this.anchor = field;
    this.onIconClick = onClick;
    this.position();
  }

  hideIcon(): void {
    this.icon.style.display = 'none';
    this.anchor = null;
  }

  /** Re-anchor after scroll/resize/layout changes. */
  position(): void {
    const el = this.anchor;
    if (!el || !el.isConnected) return this.hideIcon();
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 18 || r.bottom < 0 || r.top > innerHeight) {
      this.icon.style.display = 'none';
      return;
    }
    this.icon.style.display = 'flex';
    this.icon.style.left = `${Math.round(r.right - 28)}px`;
    this.icon.style.top = `${Math.round(r.top + (r.height - 22) / 2)}px`;
    if (this.menu) this.placeMenu(r);
    if (this.frame) this.placeFrame(r);
  }

  private placeMenu(r: DOMRect): void {
    if (!this.menu) return;
    this.menu.style.left = `${Math.max(8, Math.min(Math.round(r.left), innerWidth - 350))}px`;
    this.menu.style.top = `${Math.round(r.bottom + 4)}px`;
  }

  private placeFrame(r: DOMRect): void {
    if (!this.frame) return;
    this.frame.style.left = `${Math.max(8, Math.min(Math.round(r.left), innerWidth - 310))}px`;
    this.frame.style.top = `${Math.round(r.bottom + 4)}px`;
  }

  /**
   * "Unlock" row of the list: an extension page in an iframe, so the PIN / master password typed
   * there is invisible to the website. The page keeps keyboard focus until the user clicks it or
   * presses ArrowDown (see focusFrame).
   */
  showUnlockFrame(src: string): void {
    this.closeMenu();
    const f = document.createElement('iframe');
    f.className = 'unlock';
    f.title = 'Unlock Voult';
    f.src = src;
    this.root.append(f);
    this.frame = f;
    if (this.anchor) this.placeFrame(this.anchor.getBoundingClientRect());
  }

  get frameOpen(): boolean {
    return this.frame !== null;
  }

  focusFrame(): void {
    const f = this.frame;
    if (!f) return;
    f.focus();
    f.contentWindow?.focus();
    // Moving focus to the iframe element is not always enough to reach its input, so ask the page
    // inside to focus it too (it only listens to its parent window).
    try {
      f.contentWindow?.postMessage({ voult: 'focus' }, new URL(f.src).origin);
    } catch {
      /* frame not ready */
    }
  }

  showMenu(items: MenuItem[], note?: string): void {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    if (note) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = note;
      menu.append(n);
    }
    this.entries = [];
    this.activeIdx = -1;
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        this.closeMenu();
        item.onSelect();
      });
      this.entries.push({ button: b, select: item.onSelect });
      const av = document.createElement('span');
      av.className = 'avatar';
      const [from, to] = avatarGradient((item.label || '?').toLowerCase());
      av.style.background = `linear-gradient(135deg, ${from}, ${to})`;
      av.textContent = (item.label.trim()[0] ?? '?').toUpperCase();
      const text = document.createElement('span');
      text.className = 'text';
      const t = document.createElement('span');
      t.textContent = item.label;
      text.append(t);
      if (item.detail) {
        const s = document.createElement('small');
        s.textContent = item.detail;
        text.append(s);
      }
      b.append(av, text);
      menu.append(b);
    }
    this.root.append(menu);
    this.menu = menu;
    if (this.anchor) this.placeMenu(this.anchor.getBoundingClientRect());
  }

  closeMenu(): void {
    this.frame?.remove();
    this.frame = null;
    this.menu?.remove();
    this.menu = null;
    this.entries = [];
    this.activeIdx = -1;
  }

  /** The field the menu belongs to. */
  get anchorEl(): HTMLElement | null {
    return this.anchor;
  }

  /** Highlight the next/previous entry (keyboard navigation; focus stays in the page's input). */
  moveActive(delta: number): void {
    const n = this.entries.length;
    if (!n) return;
    this.activeIdx =
      this.activeIdx < 0 ? (delta > 0 ? 0 : n - 1) : (this.activeIdx + delta + n) % n;
    this.entries.forEach((e, i) => e.button.classList.toggle('active', i === this.activeIdx));
    this.entries[this.activeIdx]!.button.scrollIntoView({ block: 'nearest' });
  }

  get hasActive(): boolean {
    return this.activeIdx >= 0;
  }

  /** Choose the highlighted entry. */
  selectActive(): void {
    const e = this.entries[this.activeIdx];
    if (!e) return;
    this.closeMenu();
    e.select();
  }

  get menuOpen(): boolean {
    return this.menu !== null || this.frame !== null;
  }

  /** Does this event path belong to our shadow tree? */
  owns(path: EventTarget[]): boolean {
    return path.includes(this.host);
  }

  showPrompt(opts: {
    title: string;
    body: string;
    actions: { label: string; primary?: boolean; onClick: () => void }[];
  }): void {
    this.closePrompt();
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'alertdialog');
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = BAR_LOGO;
    const h = document.createElement('h2');
    h.textContent = opts.title;
    head.append(h);
    const p = document.createElement('p');
    p.textContent = opts.body;
    const row = document.createElement('div');
    row.className = 'row';
    for (const a of opts.actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        this.closePrompt();
        a.onClick();
      });
      row.append(b);
    }
    bar.append(head, p, row);
    this.root.append(bar);
    this.bar = bar;
  }

  closePrompt(): void {
    this.bar?.remove();
    this.bar = null;
  }
}
