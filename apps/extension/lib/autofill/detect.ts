/**
 * Form detection heuristics. Pure DOM logic (visibility is injectable) so it can be unit tested
 * without a real layout engine.
 */

export type FormKind = 'login' | 'register' | 'change' | 'username-step';

export interface DetectedForm {
  kind: FormKind;
  container: Element;
  username: HTMLInputElement | null;
  /** The field to fill with the stored password (the "new" one for register/change forms). */
  password: HTMLInputElement | null;
  /** The current-password field on a change-password form. */
  currentPassword: HTMLInputElement | null;
  /** Extra "confirm password" fields to fill with the same new password. */
  confirm: HTMLInputElement[];
}

export interface DetectedOtp {
  inputs: HTMLInputElement[];
}

export interface Detection {
  forms: DetectedForm[];
  otp: DetectedOtp | null;
}

export type Visible = (el: Element) => boolean;

export const defaultVisible: Visible = (el) => {
  const e = el as HTMLElement;
  if (!e.isConnected) return false;
  const style = e.ownerDocument.defaultView?.getComputedStyle(e);
  if (
    style &&
    (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
  ) {
    return false;
  }
  const r = e.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
};

/** querySelectorAll that also descends into open shadow roots. */
export function deepInputs(root: ParentNode): HTMLInputElement[] {
  const out: HTMLInputElement[] = [];
  const walk = (node: ParentNode) => {
    out.push(...node.querySelectorAll('input'));
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

const TEXTY = new Set(['', 'text', 'email', 'tel', 'url', 'number']);

function attrs(el: HTMLInputElement): string {
  return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.autocomplete]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const OTP_RE =
  /(^|[^a-z])(otp|totp|2fa|mfa|tfa|one[-_ ]?time|verification[-_ ]?code|security[-_ ]?code|auth(entication)?[-_ ]?code|passcode)([^a-z]|$)/;
const NOT_USERNAME_RE =
  /search|captcha|coupon|promo|zip|postal|otp|totp|2fa|verification|first[-_ ]?name|last[-_ ]?name|company|address|city|phone[-_ ]?code/;
const USERNAME_RE = /user|login|email|e-mail|mail|account|identifier|signin|sign-in|id\b/;

function usable(el: HTMLInputElement, visible: Visible): boolean {
  if (el.disabled || el.readOnly) return false;
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'password') return visible(el);
  return TEXTY.has(type) && visible(el);
}

function usernameScore(el: HTMLInputElement): number {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'password' || !TEXTY.has(type) || type === 'number') return -1;
  const a = attrs(el);
  if (NOT_USERNAME_RE.test(a)) return -1;
  let score = 0;
  const ac = el.autocomplete?.toLowerCase() ?? '';
  if (/\b(username|email)\b/.test(ac)) score += 10;
  if (type === 'email') score += 6;
  if (USERNAME_RE.test(a)) score += 5;
  if (type === 'text' || type === '') score += 1;
  if (type === 'tel') score += 1;
  return score;
}

function otpScore(el: HTMLInputElement): boolean {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (!['', 'text', 'number', 'tel'].includes(type)) return false;
  if (el.autocomplete?.toLowerCase().includes('one-time-code')) return true;
  const max = el.maxLength > 0 ? el.maxLength : 99;
  if (max > 8) return false;
  return OTP_RE.test(attrs(el));
}

const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function containerOf(el: HTMLInputElement): Element {
  const form = el.closest('form');
  if (form) return form;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : el.ownerDocument.body;
}

export function detect(root: ParentNode, visible: Visible = defaultVisible): Detection {
  const inputs = deepInputs(root).filter((i) => usable(i, visible));

  // --- OTP: dedicated field, or a run of single-digit boxes
  let otp: DetectedOtp | null = null;
  const singles = inputs.filter(
    (i) => i.maxLength === 1 && TEXTY.has((i.getAttribute('type') ?? '').toLowerCase()),
  );
  if (singles.length >= 4 && singles.length <= 8) otp = { inputs: singles };
  else {
    const field = inputs.find(otpScore);
    if (field) otp = { inputs: [field] };
  }
  const otpSet = new Set(otp?.inputs ?? []);

  // --- Group password fields by container
  const groups = new Map<Element, HTMLInputElement[]>();
  for (const i of inputs) {
    if (i.type !== 'password' || otpSet.has(i)) continue;
    const c = containerOf(i);
    groups.set(c, [...(groups.get(c) ?? []), i]);
  }

  const forms: DetectedForm[] = [];
  const usedUsernames = new Set<HTMLInputElement>();
  for (const [container, pws] of groups) {
    const ac = (el: HTMLInputElement) => el.autocomplete?.toLowerCase() ?? '';
    const newOnes = pws.filter((p) => ac(p).includes('new-password'));
    let kind: FormKind = 'login';
    let password = pws[0]!;
    let currentPassword: HTMLInputElement | null = null;
    let confirm: HTMLInputElement[] = [];

    if (pws.length >= 3) {
      kind = 'change';
      currentPassword = pws[0]!;
      password = newOnes[0] ?? pws[1]!;
      confirm = pws.filter((p) => p !== currentPassword && p !== password);
    } else if (pws.length === 2 && ac(pws[0]!).includes('current-password')) {
      kind = 'change';
      currentPassword = pws[0]!;
      password = pws[1]!;
    } else if (pws.length === 2) {
      kind = 'register';
      password = newOnes[0] ?? pws[0]!;
      confirm = pws.filter((p) => p !== password);
    } else if (newOnes.length === 1) {
      kind = 'register';
    }

    // Username: best-scoring text field that precedes the first password field in this container.
    const first = pws[0]!;
    let best: HTMLInputElement | null = null;
    let bestScore = 0;
    for (const i of inputs) {
      if (i === first || usedUsernames.has(i) || otpSet.has(i) || containerOf(i) !== container)
        continue;
      if (!before(i, first)) continue;
      const s = usernameScore(i);
      if (s > bestScore || (s === bestScore && s > 0 && best && before(best, i))) {
        best = i;
        bestScore = s;
      }
    }
    if (best) usedUsernames.add(best);
    forms.push({ kind, container, username: best, password, currentPassword, confirm });
  }

  // --- Username-only step of a multi-step login (no password field in the container yet)
  if (forms.length === 0 && !otp) {
    const candidates = inputs
      .filter((i) => i.type !== 'password')
      .map((i) => ({ i, s: usernameScore(i) }))
      .filter((c) => c.s >= 5)
      .sort((a, b) => b.s - a.s);
    const top = candidates[0];
    if (top && inputs.filter((i) => i.type !== 'password').length <= 3) {
      forms.push({
        kind: 'username-step',
        container: containerOf(top.i),
        username: top.i,
        password: null,
        currentPassword: null,
        confirm: [],
      });
    }
  }

  return { forms, otp };
}

/** The form a given field belongs to, if any. */
export function formForField(det: Detection, el: Element): DetectedForm | null {
  return (
    det.forms.find(
      (f) =>
        f.username === el ||
        f.password === el ||
        f.currentPassword === el ||
        f.confirm.includes(el as HTMLInputElement),
    ) ?? null
  );
}
