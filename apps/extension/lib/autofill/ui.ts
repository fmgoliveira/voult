/**
 * In-page UI (icon, dropdown, save prompt). Lives in a closed shadow root so page CSS cannot
 * restyle it and page scripts cannot read what it shows.
 */
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.icon { position: fixed; z-index: 2147483646; width: 22px; height: 22px; border: 0; padding: 0; cursor: pointer;
  border-radius: 6px; background: #4f46e5; display: none; align-items: center; justify-content: center; }
.icon svg { width: 14px; height: 14px; }
.menu { position: fixed; z-index: 2147483647; min-width: 240px; max-width: 340px; background: #fff; color: #14161a;
  border: 1px solid #e1e4ea; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 4px; font-size: 13px; }
.menu button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; border: 0; background: none;
  text-align: left; padding: 8px 10px; border-radius: 7px; cursor: pointer; color: inherit; font-size: 13px; }
.menu button:hover, .menu button:focus-visible { background: #eef0ff; outline: none; }
.menu small { color: #5b6270; font-size: 12px; }
.menu .note { padding: 8px 10px; color: #5b6270; }
.bar { position: fixed; z-index: 2147483647; top: 12px; right: 12px; width: 330px; background: #fff; color: #14161a;
  border: 1px solid #e1e4ea; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.2); padding: 14px; font-size: 13px; }
.bar h2 { margin: 0 0 4px; font-size: 14px; }
.bar p { margin: 0 0 12px; color: #5b6270; }
.bar .row { display: flex; gap: 8px; flex-wrap: wrap; }
.bar button { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #e1e4ea; background: #f5f6f8; cursor: pointer; font-size: 13px; }
.bar button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
@media (prefers-color-scheme: dark) {
  .menu, .bar { background: #181b21; color: #f2f4f8; border-color: #2a2f39; }
  .menu button:hover, .menu button:focus-visible { background: #262b35; }
  .menu small, .menu .note, .bar p { color: #9aa3b2; }
  .bar button { background: #262b35; border-color: #2a2f39; color: inherit; }
  .bar button.primary { background: #818cf8; border-color: #818cf8; color: #0f1115; }
}
`;

const LOGO =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 11l7 11 7-11" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
  }

  private placeMenu(r: DOMRect): void {
    if (!this.menu) return;
    this.menu.style.left = `${Math.max(8, Math.min(Math.round(r.left), innerWidth - 350))}px`;
    this.menu.style.top = `${Math.round(r.bottom + 4)}px`;
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
      const t = document.createElement('span');
      t.textContent = item.label;
      b.append(t);
      if (item.detail) {
        const s = document.createElement('small');
        s.textContent = item.detail;
        b.append(s);
      }
      menu.append(b);
    }
    this.root.append(menu);
    this.menu = menu;
    if (this.anchor) this.placeMenu(this.anchor.getBoundingClientRect());
  }

  closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  get menuOpen(): boolean {
    return this.menu !== null;
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
    const h = document.createElement('h2');
    h.textContent = opts.title;
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
    bar.append(h, p, row);
    this.root.append(bar);
    this.bar = bar;
  }

  closePrompt(): void {
    this.bar?.remove();
    this.bar = null;
  }
}
