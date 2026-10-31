import { createT, resolveLang, type Translate } from '@voult/core';
import { useMemo } from 'react';
import { useSettings } from './hooks';

/** Translator for the language chosen in Settings (or the browser's, by default). */
export function useT(): Translate {
  const lang = useSettings()?.language ?? 'system';
  return useMemo(() => createT(resolveLang(lang, navigator.language)), [lang]);
}
