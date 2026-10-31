import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { detect, formForField, type DetectedForm, type Detection } from '../../lib/autofill/detect';
import { fillOtp, setFieldValue } from '../../lib/autofill/fill';
import type {
  BackgroundCommand,
  CapturePrompt,
  ContentRequest,
  FillSecrets,
  QueryResponse,
} from '../../lib/autofill/messages';
import { PromptFrame } from '../../lib/autofill/prompt-frame';
import { InPageUi, type MenuItem } from '../../lib/autofill/ui';

async function send<T>(msg: ContentRequest): Promise<T | null> {
  try {
    return ((await browser.runtime.sendMessage(msg)) as T) ?? null;
  } catch {
    return null; // extension reloaded or worker unavailable
  }
}

/** The element that really has focus, looking through open shadow roots. */
function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

export default defineContentScript({
  matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const ui = new InPageUi();
    let det: Detection = { forms: [], otp: null };
    let activeForm: DetectedForm | null = null;
    let otpTried: HTMLInputElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // ------------------------------------------------------------ detection

    const rescan = () => {
      det = detect(document);
      const focused = deepActive();
      if (focused instanceof HTMLInputElement) {
        onFocus(focused);
        void maybeAutoOpen(focused);
      }
      void maybeFillOtp();
    };
    const scheduleRescan = () => {
      clearTimeout(timer);
      timer = setTimeout(rescan, 200);
    };
    new MutationObserver(scheduleRescan).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['type', 'style', 'class', 'hidden', 'disabled', 'autocomplete'],
    });
    rescan();

    async function maybeFillOtp() {
      const first = det.otp?.inputs[0];
      if (!first || otpTried === first) return;
      otpTried = first;
      const res = await send<{ code: string }>({ type: 'autofill:otp' });
      if (res && det.otp) fillOtp(det.otp.inputs, res.code);
    }

    // ------------------------------------------------------------ icon + dropdown

    function onFocus(el: HTMLInputElement) {
      let form = formForField(det, el);
      if (!form) {
        det = detect(document);
        form = formForField(det, el);
      }
      if (!form) {
        if (!ui.menuOpen) ui.hideIcon();
        activeForm = null;
        return;
      }
      activeForm = form;
      ui.showIcon(el, () => void openMenu(el, form!));
    }

    // Open the list by itself when an empty login field gets focus and there is something to offer.
    const autoTried = new WeakSet<HTMLInputElement>();
    async function maybeAutoOpen(el: HTMLInputElement) {
      if (autoTried.has(el) || el.value !== '' || ui.menuOpen) return;
      const form = formForField(det, el);
      if (!form || (form.kind !== 'login' && form.kind !== 'username-step')) return;
      autoTried.add(el);
      await openMenu(el, form, true);
    }

    document.addEventListener(
      'focusin',
      (e) => {
        const t = e.composedPath()[0];
        if (t instanceof HTMLInputElement) {
          onFocus(t);
          void maybeAutoOpen(t);
        }
      },
      true,
    );
    document.addEventListener(
      'focusout',
      (e) => {
        const t = e.composedPath()[0];
        if (t instanceof HTMLInputElement) autoTried.delete(t);
        setTimeout(() => {
          const a = deepActive();
          if (!ui.menuOpen && !(a instanceof HTMLInputElement && formForField(det, a)))
            ui.hideIcon();
        }, 150);
      },
      true,
    );
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!ui.owns(e.composedPath())) ui.closeMenu();
      },
      true,
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ui.closeMenu();
    });

    // Keyboard use of the dropdown. Focus never leaves the page's input, so typing just works.
    document.addEventListener(
      'keydown',
      (e) => {
        if (!ui.menuOpen || !e.isTrusted || deepActive() !== ui.anchorEl) return;
        if (ui.frameOpen) {
          // The unlock box is a separate page: ArrowDown moves into it, typing stays in the field.
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            ui.focusFrame();
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          ui.moveActive(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter' && ui.hasActive) {
          // Only after the user chose an entry with the arrows; otherwise Enter submits as usual.
          e.preventDefault();
          e.stopPropagation();
          ui.selectActive();
        } else if (e.key === 'Tab') ui.closeMenu();
      },
      true,
    );
    // Typing means they want their own text: get out of the way.
    document.addEventListener(
      'input',
      (e) => {
        if (ui.menuOpen && e.isTrusted && e.composedPath()[0] === ui.anchorEl) ui.closeMenu();
      },
      true,
    );
    addEventListener('scroll', () => ui.position(), true);
    addEventListener('resize', () => ui.position());

    let unlocking: { field: HTMLInputElement; form: DetectedForm } | null = null;

    async function openMenu(field: HTMLInputElement, form: DetectedForm, auto = false) {
      if (ui.menuOpen) return auto ? undefined : ui.closeMenu();
      const res = await send<QueryResponse>({ type: 'autofill:query' });
      if (auto) {
        // Automatic opening is for real matches or the unlock box, never "nothing here" notes, and
        // only if the field is still the one being used.
        const useful = res?.status === 'locked' || (res?.status === 'ok' && res.matches.length > 0);
        if (!useful) return;
        if (deepActive() !== field || field.value !== '' || ui.menuOpen) return;
      }
      if (res?.status === 'locked') {
        // Unlock right here (PIN if one is set, else the master password), then show the logins.
        unlocking = { field, form };
        ui.showUnlockFrame(browser.runtime.getURL('/unlock.html' as never));
        return;
      }
      const items: MenuItem[] = [];
      let note: string | undefined;
      if (res?.status === 'ok') {
        for (const m of res.matches) {
          items.push({
            label: m.title,
            detail: m.username,
            onSelect: () => void fillItem(m.id, form),
          });
        }
      } else if (res?.status === 'disabled') note = 'Autofill is turned off.';
      else if (form.kind === 'login' || form.kind === 'username-step')
        note = 'No saved logins for this site.';

      const wantsPassword =
        field === form.password || field === form.currentPassword || form.confirm.includes(field);
      if (
        wantsPassword &&
        (form.kind === 'register' ||
          form.kind === 'change' ||
          field.autocomplete.includes('new-password'))
      ) {
        items.push({
          label: 'Generate password',
          detail: 'Strong random password',
          onSelect: () => void generateInto(form),
        });
      }
      if (items.length === 0 && !note) note = 'Nothing to fill here.';
      ui.showMenu(items, items.length && !note ? undefined : note);
    }

    // ------------------------------------------------------------ fill

    async function fillItem(id: string, form: DetectedForm) {
      const s = await send<FillSecrets>({ type: 'autofill:fill', id });
      if (!s) return;
      if (form.username && s.username) setFieldValue(form.username, s.username);
      const pwTarget = form.kind === 'change' ? form.currentPassword : form.password;
      if (pwTarget && s.password) setFieldValue(pwTarget, s.password);
      if (s.totp && det.otp) fillOtp(det.otp.inputs, s.totp);
      ui.closeMenu();
    }

    async function generateInto(form: DetectedForm) {
      const g = await send<{ password: string }>({ type: 'autofill:generate' });
      if (!g) return;
      if (form.password) setFieldValue(form.password, g.password);
      for (const c of form.confirm) setFieldValue(c, g.password);
    }

    // ------------------------------------------------------------ save / update prompts

    let lastCapture = '';
    let lastCaptureAt = 0;

    function captureFrom(target: Element | null) {
      const form =
        det.forms.find((f) => target && f.container.contains(target) && f.password?.value) ??
        det.forms.find((f) => f.password?.value);
      if (!form?.password?.value) return;
      const payload = {
        type: 'capture:submit' as const,
        username: form.username?.value ?? '',
        password: form.password.value,
        isNewPassword: form.kind === 'register' || form.kind === 'change',
      };
      const key = `${payload.username}\n${payload.password}`;
      if (key === lastCapture && Date.now() - lastCaptureAt < 2000) return;
      lastCapture = key;
      lastCaptureAt = Date.now();
      void send(payload);
    }

    document.addEventListener('submit', (e) => captureFrom(e.target as Element), true);
    document.addEventListener(
      'click',
      (e) => {
        const t = e.composedPath()[0];
        if (!(t instanceof Element)) return;
        const btn = t.closest('button, input[type=submit], input[type=button], [role=button]');
        if (btn) captureFrom(btn);
      },
      true,
    );
    document.addEventListener(
      'keydown',
      (e) => {
        const t = e.composedPath()[0];
        if (e.key === 'Enter' && t instanceof HTMLInputElement && t.type === 'password')
          captureFrom(t);
      },
      true,
    );

    async function showCapturePrompt() {
      if (window !== window.top) return;
      const p = await send<CapturePrompt>({ type: 'capture:poll' });
      if (!p) return;
      const update = p.action === 'update';
      ui.showPrompt({
        title: update ? `Update password for ${p.host}?` : `Save password for ${p.host}?`,
        body: p.username ? `Account: ${p.username}` : 'Voult will keep it encrypted in your vault.',
        actions: [
          {
            label: update ? 'Update' : 'Save',
            primary: true,
            onClick: () => void send({ type: 'capture:accept' }),
          },
          { label: 'Not now', onClick: () => void send({ type: 'capture:dismiss', never: false }) },
          {
            label: 'Never for this site',
            onClick: () => void send({ type: 'capture:dismiss', never: true }),
          },
        ],
      });
    }
    setTimeout(() => void showCapturePrompt(), 500);

    // ------------------------------------------------------------ commands from the background

    const promptFrame = new PromptFrame();
    browser.runtime.onMessage.addListener(
      (msg: BackgroundCommand | { type: 'capture:show' }, _sender, sendResponse) => {
        if (msg.type === 'prompt:show') {
          // Only the top frame hosts the prompt.
          if (window !== window.top) return undefined;
          promptFrame.show(msg.id, () => void send({ type: 'prompt:dismiss', id: msg.id }));
          sendResponse(true);
          return undefined;
        }
        if (msg.type === 'prompt:hide') promptFrame.hide();
        if ((msg.type === 'unlock:done' || msg.type === 'unlock:close') && ui.frameOpen) {
          const u = unlocking;
          unlocking = null;
          ui.closeMenu();
          if (u) {
            u.field.focus();
            if (msg.type === 'unlock:done') void openMenu(u.field, u.form);
          }
          return undefined;
        }
        if (msg.type === 'capture:show') void showCapturePrompt();
        if (msg.type === 'autofill:trigger') void triggerFill();
        if (msg.type === 'autofill:generate-here') void generateHere();
        return undefined;
      },
    );

    async function triggerFill() {
      det = detect(document);
      const focused = deepActive();
      const form =
        (focused instanceof HTMLInputElement ? formForField(det, focused) : null) ??
        activeForm ??
        det.forms[0];
      if (!form) return;
      const anchor =
        (focused instanceof HTMLInputElement && formForField(det, focused) ? focused : null) ??
        form.username ??
        form.password;
      if (!anchor) return;
      const res = await send<QueryResponse>({ type: 'autofill:query' });
      if (res?.status === 'ok' && res.matches.length === 1)
        return fillItem(res.matches[0]!.id, form);
      ui.showIcon(anchor, () => void openMenu(anchor, form));
      await openMenu(anchor, form);
    }

    async function generateHere() {
      const el = deepActive();
      if (!(el instanceof HTMLInputElement)) return;
      const g = await send<{ password: string }>({ type: 'autofill:generate' });
      if (!g) return;
      det = detect(document);
      const form = formForField(det, el);
      if (form && form.password) {
        setFieldValue(form.password, g.password);
        for (const c of form.confirm) setFieldValue(c, g.password);
      } else setFieldValue(el, g.password);
    }
  },
});
