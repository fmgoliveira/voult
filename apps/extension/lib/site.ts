import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { browser } from 'wxt/browser';

/** URL of the page the user was on when they opened Voult (null for browser pages and the like). */
async function activeSiteUrl(): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      windowType: 'normal',
      currentWindow: true,
    });
    const [fallback] = tab
      ? []
      : await browser.tabs.query({ active: true, windowType: 'normal', lastFocusedWindow: true });
    const url = (tab ?? fallback)?.url ?? '';
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

export function useActiveSite(): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void activeSiteUrl().then(setUrl);
  }, []);
  return url;
}

/** The "this site" filter is on by default; removing it lasts until the popup closes. */
export const useSiteFilter = create<{ dismissed: boolean; dismiss: () => void }>((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));
