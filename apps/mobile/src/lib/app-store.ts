import {
  ApiError,
  SignedOutError,
  WrongPasswordError,
  getAccount,
  type ItemView,
  type SyncResult,
  type VaultView,
} from '@voult/core';
import { AppState } from 'react-native';
import { create } from 'zustand';
import * as Native from '../../modules/voult-native';
import { getRuntime, hooks, type Runtime } from './runtime';
import { DEFAULT_SETTINGS, shouldLockAfterBackground, type Settings } from './settings';

export type Phase = 'booting' | 'welcome' | 'recovery' | 'reauth' | 'locked' | 'ready';

interface AppState_ {
  phase: Phase;
  email: string;
  serverUrl: string;
  pendingRecovery: string | null;
  vaults: VaultView[];
  items: ItemView[];
  settings: Settings;
  quick: { biometric: boolean; pin: boolean; biometricAvailable: boolean };
  pendingOps: number;
  syncing: boolean;
  lastSync: SyncResult | null;
  /** Re-read everything from local storage. */
  refresh(): Promise<void>;
  lock(): Promise<void>;
  syncNow(): Promise<SyncResult | null>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
}

export const useApp = create<AppState_>((set, get) => ({
  phase: 'booting',
  email: '',
  serverUrl: '',
  pendingRecovery: null,
  vaults: [],
  items: [],
  settings: DEFAULT_SETTINGS,
  quick: { biometric: false, pin: false, biometricAvailable: false },
  pendingOps: 0,
  syncing: false,
  lastSync: null,

  async refresh() {
    const rt = await getRuntime();
    const account = await getAccount(rt.store);
    const settings = await rt.settings.get();
    const quick = {
      biometric: await rt.quick.hasBiometric(),
      pin: await rt.quick.hasPin(),
      biometricAvailable: rt.quick.biometricAvailable(),
    };
    const pendingOps = (await rt.store.listOutbox()).length;
    if (!account) {
      return set({
        phase: 'welcome',
        email: '',
        serverUrl: '',
        items: [],
        vaults: [],
        settings,
        quick,
        pendingOps,
      });
    }
    const base = {
      email: account.email,
      serverUrl: account.serverUrl,
      settings,
      quick,
      pendingOps,
    };
    const key = await rt.getAccountKey();
    if (!(await rt.http.hasTokens())) return set({ ...base, phase: 'reauth' });
    if (!key) return set({ ...base, phase: 'locked', items: [], vaults: [] });
    if (!account.recoveryConfirmed) {
      return set({ ...base, phase: 'recovery', pendingRecovery: rt.getPendingRecovery() });
    }
    const data = await rt.vault.loadVault();
    set({ ...base, phase: 'ready', vaults: data.vaults, items: data.items, pendingRecovery: null });
  },

  async lock() {
    const rt = await getRuntime();
    await rt.clearAccountKey();
    await get().refresh();
  },

  async syncNow() {
    return runSync();
  },

  async updateSettings(patch) {
    const rt = await getRuntime();
    const next = await rt.settings.update(patch);
    set({ settings: next });
    if ('blockScreenshots' in patch) void Native.setSecureScreen(next.blockScreenshots);
  },
}));

// ------------------------------------------------------------------ sync scheduling

let syncing: Promise<SyncResult | null> | null = null;
let queued = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function runSync(): Promise<SyncResult | null> {
  if (syncing) {
    queued = true;
    return syncing;
  }
  const rt = await getRuntime();
  if (!(await getAccount(rt.store)) || !(await rt.http.hasTokens())) return null;
  useApp.setState({ syncing: true });
  syncing = rt
    .syncOnce()
    .catch((e) => {
      if (!(e instanceof SignedOutError)) console.warn('sync failed');
      return null;
    })
    .then(async (result) => {
      useApp.setState({ syncing: false, lastSync: result });
      await useApp.getState().refresh();
      return result;
    })
    .finally(() => {
      syncing = null;
      if (queued) {
        queued = false;
        void runSync();
      }
    });
  return syncing;
}

hooks.onRequestSync = () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void runSync(), 300);
  void useApp.getState().refresh(); // local write: show it immediately
};

// ------------------------------------------------------------------ realtime (foreground only)

interface Sock {
  readyState: number;
  close(): void;
}
let socket: Sock | null = null;
let reconnect: ReturnType<typeof setTimeout> | undefined;

async function connectRealtime(rt: Runtime) {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  if (!(await rt.http.hasTokens())) return;
  try {
    const { token, serverUrl } = await rt.http.getAccessToken();
    const ws = new WebSocket(serverUrl.replace(/^http/, 'ws') + '/ws') as unknown as WebSocket &
      Sock;
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (e) => {
      if (JSON.parse(String(e.data)).type === 'rev') void runSync();
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (AppState.currentState === 'active') {
        clearTimeout(reconnect);
        reconnect = setTimeout(() => void connectRealtime(rt), 5000);
      }
    };
    ws.onerror = () => ws.close();
  } catch {
    socket = null;
  }
}

function disconnectRealtime() {
  clearTimeout(reconnect);
  const s = socket;
  socket = null;
  s?.close();
}

// ------------------------------------------------------------------ lifecycle

let backgroundedAt: number | null = null;
let clipboardClearAt = 0;
let poll: ReturnType<typeof setInterval> | undefined;

export function noteClipboardClear(afterSeconds: number) {
  clipboardClearAt = afterSeconds > 0 ? Date.now() + afterSeconds * 1000 : 0;
}

/** Call once from the root layout. Returns a cleanup function. */
export async function startApp(): Promise<() => void> {
  const rt = await getRuntime();
  await useApp.getState().refresh();
  void Native.setSecureScreen(useApp.getState().settings.blockScreenshots);

  const onActive = async () => {
    const { settings, phase } = useApp.getState();
    if (clipboardClearAt && Date.now() >= clipboardClearAt) {
      Native.clearClipboard();
      clipboardClearAt = 0;
    }
    if (backgroundedAt !== null && phase === 'ready') {
      if (shouldLockAfterBackground(Date.now() - backgroundedAt, settings.autoLockMinutes)) {
        await rt.clearAccountKey();
      }
    }
    backgroundedAt = null;
    await useApp.getState().refresh();
    void connectRealtime(rt);
    void runSync();
    clearInterval(poll);
    poll = setInterval(() => void runSync(), 60_000);
  };
  const onBackground = () => {
    backgroundedAt = Date.now();
    disconnectRealtime();
    clearInterval(poll);
    // "Immediately" must not leave decrypted keys in memory while the app is out of sight.
    if (useApp.getState().settings.autoLockMinutes === 0) void rt.clearAccountKey();
  };

  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void onActive();
    else onBackground();
  });
  if (AppState.currentState === 'active') void onActive();

  return () => {
    sub.remove();
    disconnectRealtime();
    clearInterval(poll);
  };
}

// ------------------------------------------------------------------ friendly errors

export function friendlyError(e: unknown): string {
  if (e instanceof WrongPasswordError) return 'Wrong password.';
  if (e instanceof ApiError) {
    if (e.code === 'signup_closed') return 'Signup is closed on this server.';
    if (e.code === 'email_taken') return 'That email already has an account.';
    if (e.code === 'rate_limited') return 'Too many attempts. Try again in a minute.';
    if (e.code === 'invalid_credentials') return 'Wrong email or password.';
    return `Server error (${e.code}).`;
  }
  if (e instanceof TypeError) return 'Cannot reach the server. Check the URL and your connection.';
  return e instanceof Error ? e.message : 'Something went wrong.';
}
