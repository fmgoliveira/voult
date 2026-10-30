import type { ItemType } from '@voult/core';
import { create } from 'zustand';
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

export const useNav = create<NavState>((set) => ({
  tab: 'vault',
  view: { name: 'list' },
  query: { text: '', type: 'all', vaultId: 'all', sort: 'title', trash: false },
  setTab: (tab) => set({ tab, view: { name: 'list' } }),
  open: (view) => set({ view }),
  back: () => set({ view: { name: 'list' } }),
  patchQuery: (p) => set((s) => ({ query: { ...s.query, ...p } })),
}));
