import type { ListQuery } from '@voult/core';
import { create } from 'zustand';

interface QueryState {
  query: ListQuery;
  patch(p: Partial<ListQuery>): void;
}

export const useListQuery = create<QueryState>((set) => ({
  query: { text: '', type: 'all', vaultId: 'all', sort: 'title', trash: false },
  patch: (p) => set((s) => ({ query: { ...s.query, ...p } })),
}));
