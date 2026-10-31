import { describe, expect, it } from 'vitest';
import { createT, en, pt, resolveLang } from './index';

describe('i18n', () => {
  it('has the same keys and placeholders in both languages', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(pt[k]), k).toEqual(vars(en[k]));
      expect(pt[k].trim(), k).not.toBe('');
    }
  });

  it('resolves the language and interpolates', () => {
    expect(resolveLang('system', 'pt-PT')).toBe('pt');
    expect(resolveLang('system', 'en-GB')).toBe('en');
    expect(resolveLang('system', undefined)).toBe('en');
    expect(resolveLang('en', 'pt-PT')).toBe('en');
    expect(createT('pt')('import.found', { n: 3 })).toBe('3 itens encontrados');
    expect(createT('en')('import.found', { n: 1 })).toBe('1 items found');
    expect(createT('en')('import.run')).toBe('Import {n} items');
  });
});
