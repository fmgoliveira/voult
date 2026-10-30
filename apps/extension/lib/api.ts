import {
  ApiError,
  SignedOutError,
  createHttp,
  type AccessToken,
  type RefreshCredentials,
  type TokenStore,
} from '@voult/core';
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { store } from './db';

export { ApiError, SignedOutError };

const refreshItem = storage.defineItem<RefreshCredentials | null>('local:tokens', {
  fallback: null,
});

/** Refresh token persists in storage.local; the short-lived access token lives in storage.session. */
const tokens: TokenStore = {
  getRefresh: () => refreshItem.getValue(),
  setRefresh: (v) => refreshItem.setValue(v),
  async getAccess() {
    const r = await browser.storage.session.get('access');
    return (r.access as AccessToken | undefined) ?? null;
  },
  async setAccess(v) {
    if (v) await browser.storage.session.set({ access: v });
    else await browser.storage.session.remove(['access']);
  },
};

/** One Web Lock is shared by every extension context so token refreshes never race. */
export const lock = <T>(name: string, fn: () => Promise<T>): Promise<T> =>
  navigator.locks ? (navigator.locks.request(name, fn) as Promise<T>) : fn();

export const http = createHttp({ store, tokens, lock });

export const {
  publicRequest,
  request,
  requestOk,
  saveTokens,
  clearTokens,
  hasTokens,
  getAccessToken,
} = http;
