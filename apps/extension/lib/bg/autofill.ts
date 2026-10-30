import {
  baseDomain,
  currentCode,
  generatePassword,
  hostnameOf,
  matchLogin,
  type LoginItem,
} from '@voult/core';
import type { Sender } from './types';
import type {
  CapturePrompt,
  ContentRequest,
  FillSecrets,
  MatchSummary,
  QueryResponse,
} from '../autofill/messages';
import { getSettings, updateSettings } from '../settings';
import { saveItem, saveLoginEdit, type ItemView } from '../vault';
import { getVaultData, invalidateItems, liveLogins } from './items';

const frameUrl = (s: Sender): string | null => s.url ?? null;

interface PendingCapture {
  action: 'save' | 'update';
  url: string;
  host: string;
  username: string;
  password: string;
  existing: ItemView | null;
  at: number;
}
const CAPTURE_TTL_MS = 90_000;
const pendingCapture = new Map<number, PendingCapture>();

interface PendingOtp {
  domain: string;
  code: () => string;
  at: number;
}
const OTP_TTL_MS = 3 * 60_000;
const pendingOtp = new Map<number, PendingOtp>();

const summary = (v: ItemView): MatchSummary => {
  const l = v.item as LoginItem;
  return { id: v.id, title: l.title, username: l.username || l.email, hasTotp: !!l.totp };
};

export async function handleQuery(sender: Sender): Promise<QueryResponse> {
  const url = frameUrl(sender);
  const settings = await getSettings();
  if (!settings.autofillEnabled || !url) return { status: 'disabled' };
  const data = await getVaultData();
  if (!data) return { status: 'locked' };
  const matches = liveLogins(data.items).filter((v) => matchLogin(v.item as LoginItem, url));
  return matches.length ? { status: 'ok', matches: matches.map(summary) } : { status: 'none' };
}

/** Releases secrets only for an item that matches the *actual* URL of the requesting frame. */
export async function handleFill(sender: Sender, id: string): Promise<FillSecrets | null> {
  const url = frameUrl(sender);
  if (!url) return null;
  const data = await getVaultData();
  const view = data?.items.find((v) => v.id === id && v.deletedAt === null);
  if (!view || view.item.type !== 'login' || !matchLogin(view.item, url)) return null;
  const login = view.item;

  let totp: string | null = null;
  if (login.totp) {
    const t = login.totp;
    totp = currentCode(t, Date.now()).code;
    if (sender.tab?.id !== undefined) {
      // A later page of the same login flow (OTP step) may ask for a fresh code.
      pendingOtp.set(sender.tab.id, {
        domain: baseDomain(hostnameOf(url) ?? ''),
        code: () => currentCode(t, Date.now()).code,
        at: Date.now(),
      });
    }
  }
  return { username: login.username || login.email, password: login.password, totp };
}

export async function handleOtp(sender: Sender): Promise<{ code: string } | null> {
  const url = frameUrl(sender);
  const tabId = sender.tab?.id;
  if (!url || tabId === undefined) return null;
  const p = pendingOtp.get(tabId);
  if (!p || Date.now() - p.at > OTP_TTL_MS || p.domain !== baseDomain(hostnameOf(url) ?? '')) {
    return null;
  }
  return { code: p.code() };
}

export const handleGenerate = (): { password: string } => ({
  password: generatePassword({ length: 20 }),
});

// ------------------------------------------------------------------ save / update prompts

const stripWww = (h: string) => h.replace(/^www\./, '');

export async function handleSubmit(
  sender: Sender,
  msg: Extract<ContentRequest, { type: 'capture:submit' }>,
): Promise<void> {
  const url = frameUrl(sender);
  const tabId = sender.tab?.id;
  if (!url || tabId === undefined || !msg.password) return;
  const host = hostnameOf(url);
  if (!host) return;
  const settings = await getSettings();
  if (!settings.autofillEnabled || settings.neverSave.includes(stripWww(host))) return;
  const data = await getVaultData();
  if (!data) return; // locked: nothing to compare against

  const username = msg.username.trim();
  const matches = liveLogins(data.items).filter((v) => matchLogin(v.item as LoginItem, url));
  const sameUser = matches.find(
    (v) =>
      ((v.item as LoginItem).username || (v.item as LoginItem).email).toLowerCase() ===
      username.toLowerCase(),
  );
  // A password-change form usually has no username field: update the only match.
  const target = sameUser ?? (!username && matches.length === 1 ? matches[0]! : null);

  if (target) {
    if ((target.item as LoginItem).password === msg.password) return;
    pendingCapture.set(tabId, {
      action: 'update',
      url,
      host,
      username,
      password: msg.password,
      existing: target,
      at: Date.now(),
    });
  } else {
    pendingCapture.set(tabId, {
      action: 'save',
      url,
      host,
      username,
      password: msg.password,
      existing: null,
      at: Date.now(),
    });
  }
}

export function handlePoll(sender: Sender): CapturePrompt | null {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0) return null;
  const p = pendingCapture.get(tabId);
  if (!p || Date.now() - p.at > CAPTURE_TTL_MS) {
    pendingCapture.delete(tabId);
    return null;
  }
  const existingLogin = p.existing?.item as LoginItem | undefined;
  return {
    action: p.action,
    host: stripWww(p.host),
    username: p.username || existingLogin?.username || '',
    title: existingLogin?.title ?? stripWww(p.host),
  };
}

export async function handleAccept(sender: Sender): Promise<boolean> {
  const tabId = sender.tab?.id;
  const p = tabId === undefined ? undefined : pendingCapture.get(tabId);
  if (tabId === undefined || !p) return false;
  pendingCapture.delete(tabId);

  if (p.action === 'update' && p.existing) {
    await saveLoginEdit(p.existing, { password: p.password });
  } else {
    const data = await getVaultData();
    const vault = data?.vaults[0];
    if (!vault) return false;
    const now = Date.now();
    const origin = new URL(p.url).origin;
    await saveItem(vault.id, {
      type: 'login',
      title: stripWww(p.host),
      username: p.username,
      email: '',
      password: p.password,
      notes: '',
      favorite: false,
      pinned: false,
      urls: [{ url: origin, match: 'domain' }],
      customFields: [],
      passkeys: [],
      passwordHistory: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  invalidateItems();
  return true;
}

export async function handleDismiss(sender: Sender, never: boolean): Promise<void> {
  const tabId = sender.tab?.id;
  const p = tabId === undefined ? undefined : pendingCapture.get(tabId);
  if (tabId === undefined || !p) return;
  pendingCapture.delete(tabId);
  if (never) {
    const s = await getSettings();
    await updateSettings({ neverSave: [...new Set([...s.neverSave, stripWww(p.host)])] });
  }
}
