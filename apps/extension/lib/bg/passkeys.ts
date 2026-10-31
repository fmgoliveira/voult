import {
  buildClientDataJSON,
  createPasskey,
  getAssertion,
  hostnameOf,
  isValidRpId,
  matchLogin,
  toBase64Url,
  type LoginItem,
} from '@voult/core';
import { browser } from 'wxt/browser';
import type { Sender } from './types';
import type {
  PasskeyCreateOptions,
  PasskeyCreateResult,
  PasskeyGetOptions,
  PasskeyGetResult,
  PasskeyResponse,
} from '../autofill/messages';
import { getSettings } from '../settings';
import { saveItem, saveLoginEdit } from '../vault';
import { getVaultData, invalidateItems, liveLogins } from './items';
import type { PromptDecision, PromptRequest } from './prompt-types';

// ---------------------------------------------------------------- picker window plumbing

interface PendingPrompt {
  request: PromptRequest;
  resolve: (d: PromptDecision) => void;
  /** Set when the prompt is shown inside this tab's page. */
  tabId?: number;
  windowId?: number;
}
const prompts = new Map<string, PendingPrompt>();

export function getPromptRequest(id: string): PromptRequest | null {
  return prompts.get(id)?.request ?? null;
}

export function decidePrompt(id: string, decision: PromptDecision): void {
  const p = prompts.get(id);
  if (!p) return;
  prompts.delete(id);
  p.resolve(decision);
  if (p.windowId !== undefined) void browser.windows.remove(p.windowId).catch(() => undefined);
  if (p.tabId !== undefined)
    void browser.tabs
      .sendMessage(p.tabId, { type: 'prompt:hide' }, { frameId: 0 })
      .catch(() => undefined);
}

/** The page's backdrop was clicked: only the tab showing that prompt may cancel it. */
export function dismissPrompt(id: string, sender: Sender): void {
  const p = prompts.get(id);
  if (p && p.tabId !== undefined && p.tabId === sender.tab?.id && sender.frameId === 0)
    decidePrompt(id, { action: 'cancel' });
}

/** Shows the prompt over the page; resolves false if this tab cannot host it. */
async function showInPage(id: string, entry: PendingPrompt, tabId: number | undefined) {
  if (tabId === undefined) return false;
  try {
    const shown = await browser.tabs.sendMessage(
      tabId,
      { type: 'prompt:show', id },
      { frameId: 0 },
    );
    if (shown === true) entry.tabId = tabId;
    return shown === true;
  } catch {
    return false; // no content script here (restricted page, still loading)
  }
}

async function askUser(request: PromptRequest, sender: Sender): Promise<PromptDecision> {
  const id = crypto.randomUUID();
  return new Promise<PromptDecision>((resolve) => {
    const entry: PendingPrompt = { request, resolve };
    prompts.set(id, entry);
    void showInPage(id, entry, sender.tab?.id).then((shown) => {
      if (shown || !prompts.has(id)) return;
      // Fall back to a small window.
      browser.windows
        .create({
          url: browser.runtime.getURL(`/prompt.html?id=${id}` as never),
          type: 'popup',
          width: 400,
          height: 560,
          focused: true,
        })
        .then((w) => {
          entry.windowId = w?.id;
        })
        .catch(() => decidePrompt(id, { action: 'fallback' }));
    });
  });
}

/** Closing the window without choosing counts as cancel. */
export function watchPromptWindows(): void {
  browser.windows.onRemoved.addListener((windowId) => {
    for (const [id, p] of prompts) {
      if (p.windowId === windowId) {
        prompts.delete(id);
        p.resolve({ action: 'cancel' });
      }
    }
  });
  // An in-page prompt dies with its tab or page.
  const cancelTab = (tabId: number) => {
    for (const [id, p] of prompts) if (p.tabId === tabId) decidePrompt(id, { action: 'cancel' });
  };
  browser.tabs.onRemoved.addListener(cancelTab);
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') cancelTab(tabId);
  });
}

// ---------------------------------------------------------------- shared checks

interface Context {
  origin: string;
  host: string;
  crossOrigin: boolean;
}

async function contextFor(
  sender: Sender,
  rpId: string,
): Promise<Context | 'fallback' | 'security'> {
  const url = sender.url;
  const settings = await getSettings();
  if (!settings.passkeysEnabled || !url) return 'fallback';
  const host = hostnameOf(url);
  if (!host || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) return 'fallback';
  if (settings.passkeyOptOut.some((o) => o === host || o === rpId)) return 'fallback';
  if (!isValidRpId(rpId, host)) return 'security';
  const origin = new URL(url).origin;
  const tabOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : origin;
  return { origin, host, crossOrigin: origin !== tabOrigin };
}

const b64 = (b: Uint8Array) => toBase64Url(b);

// ---------------------------------------------------------------- create

export async function handlePasskeyCreate(
  sender: Sender,
  o: PasskeyCreateOptions,
): Promise<PasskeyResponse<PasskeyCreateResult>> {
  const ctx = await contextFor(sender, o.rpId);
  if (ctx === 'fallback') return { status: 'fallback' };
  if (ctx === 'security') return { status: 'error', name: 'SecurityError' };
  // We only produce ES256; if the site demands something else let the browser handle it.
  if (o.pubKeyCredParams.length > 0 && !o.pubKeyCredParams.some((p) => p.alg === -7)) {
    return { status: 'fallback' };
  }
  const data = await getVaultData();
  if (!data) return { status: 'fallback' }; // locked: the browser's own UI takes over

  const logins = liveLogins(data.items);
  const known = new Set(o.excludeCredentials);
  if (
    logins.some((v) =>
      (v.item as LoginItem).passkeys.some((k) => k.rpId === o.rpId && known.has(k.credentialId)),
    )
  ) {
    return { status: 'error', name: 'InvalidStateError' };
  }

  const decision = await askUser(
    {
      kind: 'create',
      host: ctx.host,
      rpId: o.rpId,
      rpName: o.rpName,
      userName: o.user.name,
      candidates: logins
        .filter((v) => matchLogin(v.item as LoginItem, sender.url!))
        .map((v) => ({ id: v.id, title: v.item.title, username: (v.item as LoginItem).username })),
    },
    sender,
  );
  if (decision.action === 'fallback') return { status: 'fallback' };
  if (decision.action !== 'create-new' && decision.action !== 'attach') {
    return { status: 'error', name: 'NotAllowedError' };
  }

  const created = createPasskey({
    rpId: o.rpId,
    rpName: o.rpName,
    userHandle: o.user.id,
    userName: o.user.name,
    clientDataJSON: buildClientDataJSON({
      type: 'webauthn.create',
      challenge: o.challenge,
      origin: ctx.origin,
      crossOrigin: ctx.crossOrigin,
    }),
  });

  if (decision.action === 'attach') {
    const target = data.items.find((v) => v.id === decision.itemId && v.item.type === 'login');
    if (!target) return { status: 'error', name: 'NotAllowedError' };
    await saveLoginEdit(target, {
      passkeys: [...(target.item as LoginItem).passkeys, created.passkey],
    });
  } else {
    const vault = data.vaults[0];
    if (!vault) return { status: 'error', name: 'NotAllowedError' };
    const now = Date.now();
    await saveItem(vault.id, {
      type: 'login',
      title: o.rpName || o.rpId,
      username: o.user.name,
      email: '',
      password: '',
      notes: '',
      favorite: false,
      pinned: false,
      urls: [{ url: `https://${o.rpId}`, match: 'domain' }],
      customFields: [],
      passkeys: [created.passkey],
      passwordHistory: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  invalidateItems();

  return {
    status: 'ok',
    result: {
      id: created.passkey.credentialId,
      attestationObject: b64(created.attestationObject),
      clientDataJSON: b64(created.clientDataJSON),
      authenticatorData: b64(created.authData),
      publicKey: b64(created.publicKeySpki),
    },
  };
}

// ---------------------------------------------------------------- get

export async function handlePasskeyGet(
  sender: Sender,
  o: PasskeyGetOptions,
): Promise<PasskeyResponse<PasskeyGetResult>> {
  const ctx = await contextFor(sender, o.rpId);
  if (ctx === 'fallback') return { status: 'fallback' };
  if (ctx === 'security') return { status: 'error', name: 'SecurityError' };
  const data = await getVaultData();
  if (!data) return { status: 'fallback' };

  const options = liveLogins(data.items).flatMap((v) =>
    (v.item as LoginItem).passkeys
      .filter(
        (k) =>
          k.rpId === o.rpId &&
          (o.allowCredentials.length === 0 || o.allowCredentials.includes(k.credentialId)),
      )
      .map((k) => ({
        itemId: v.id,
        credentialId: k.credentialId,
        title: v.item.title,
        userName: k.userName || (v.item as LoginItem).username,
        createdAt: k.createdAt,
      })),
  );
  if (options.length === 0) return { status: 'fallback' };

  const decision = await askUser({ kind: 'get', host: ctx.host, rpId: o.rpId, options }, sender);
  if (decision.action === 'fallback') return { status: 'fallback' };
  if (decision.action !== 'use') return { status: 'error', name: 'NotAllowedError' };

  const view = data.items.find((v) => v.id === decision.itemId);
  const login = view?.item as LoginItem | undefined;
  const passkey = login?.passkeys.find((k) => k.credentialId === decision.credentialId);
  if (!view || !login || !passkey || passkey.rpId !== o.rpId) {
    return { status: 'error', name: 'NotAllowedError' };
  }

  const assertion = getAssertion(
    passkey,
    buildClientDataJSON({
      type: 'webauthn.get',
      challenge: o.challenge,
      origin: ctx.origin,
      crossOrigin: ctx.crossOrigin,
    }),
  );
  // Persist the advanced sign counter.
  await saveLoginEdit(view, {
    passkeys: login.passkeys.map((k) =>
      k.credentialId === passkey.credentialId ? assertion.updated : k,
    ),
  });
  invalidateItems();

  return {
    status: 'ok',
    result: {
      id: passkey.credentialId,
      authenticatorData: b64(assertion.authData),
      clientDataJSON: b64(assertion.clientDataJSON),
      signature: b64(assertion.signature),
      userHandle: b64(assertion.userHandle),
    },
  };
}
