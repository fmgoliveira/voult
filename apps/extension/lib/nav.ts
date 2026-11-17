import type { ItemType } from '@voult/core';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { browser } from 'wxt/browser';
import type { ListQuery } from '@voult/core';

export type Tab = 'vault' | 'authenticator' | 'generator' | 'settings';

export type View =
  | { name: 'list' }
  | { name: 'detail'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'new'; type: ItemType };

interface NavState {
  tab: Tab;
  view: View;
  query: ListQuery;
  setTab: (t: Tab) => void;
  open: (v: View) => void;
  back: () => void;
  patchQuery: (p: Partial<ListQuery>) => void;
}

// Remember where the user was when the popup closes (memory-only, see lib/draft.ts).
const sessionStore = createJSONStorage<Pick<NavState, 'tab' | 'view' | 'query'>>(() => ({
  getItem: async (k) => ((await browser.storage.session.get(k))[k] as string | undefined) ?? null,
  setItem: (k, v) => browser.storage.session.set({ [k]: v }),
  removeItem: (k) => browser.storage.session.remove(k),
}));

export const useNav = create<NavState>()(
  persist(
    (set) => ({
      tab: 'vault',
      view: { name: 'list' },
      query: { text: '', type: 'all', vaultId: 'all', sort: 'title', trash: false },
      setTab: (tab) => set({ tab, view: { name: 'list' } }),
      open: (view) => set({ view }),
      back: () => set({ view: { name: 'list' } }),
      patchQuery: (p) => set((s) => ({ query: { ...s.query, ...p } })),
    }),
    {
      name: 'nav',
      storage: sessionStore,
      partialize: ({ tab, view, query }) => ({ tab, view, query }),
    },
  ),
);
