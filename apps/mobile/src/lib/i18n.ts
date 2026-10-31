import { createT, resolveLang, type Translate } from '@voult/core';
import { useMemo } from 'react';
import { useApp } from './app-store';

/** Translator for the language chosen in Settings (or the phone's, by default). */
export function useT(): Translate {
  const lang = useApp((s) => s.settings.language);
  return useMemo(() => {
    let locale: string | undefined;
    try {
      locale = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      /* no Intl: English */
    }
    return createT(resolveLang(lang, locale));
  }, [lang]);
}
