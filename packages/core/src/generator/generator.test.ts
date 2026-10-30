import { describe, expect, it } from 'vitest';
import { EFF_WORDLIST } from '../wordlists/eff-large';
import { generatePassphrase, generatePassword, randomInt } from './generator';

describe('randomInt', () => {
  it('stays in range and is roughly uniform', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) counts[randomInt(6)]++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });
  it('rejects invalid bounds', () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(1.5)).toThrow();
    expect(randomInt(1)).toBe(0);
  });
});

describe('generatePassword', () => {
  it('honours length and includes every selected class', () => {
    for (let i = 0; i < 100; i++) {
      const p = generatePassword({ length: 4 });
      expect(p).toHaveLength(4);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
    }
    expect(generatePassword({ length: 64 })).toHaveLength(64);
  });
  it('respects toggles', () => {
    const p = generatePassword({ length: 40, upper: false, symbols: false, digits: false });
    expect(p).toMatch(/^[a-z]{40}$/);
  });
  it('excludes ambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword({ length: 64, excludeAmbiguous: true })).not.toMatch(/[Il1O0]/);
    }
  });
  it('validates input', () => {
    expect(() => generatePassword({ length: 3 })).toThrow(RangeError);
    expect(() => generatePassword({ length: 65 })).toThrow(RangeError);
    expect(() =>
      generatePassword({ upper: false, lower: false, digits: false, symbols: false }),
    ).toThrow('at least one');
  });
  it('produces different values', () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe('generatePassphrase', () => {
  it('has the EFF list with 7776 words', () => {
    expect(EFF_WORDLIST).toHaveLength(7776);
    expect(new Set(EFF_WORDLIST).size).toBe(7776);
  });
  it('builds words with separator, capitalisation and digit', () => {
    const p = generatePassphrase({ words: 4, separator: '.', capitalize: true, appendDigit: true });
    const parts = p.split('.');
    expect(parts).toHaveLength(4);
    for (const w of parts) expect(w).toMatch(/^[A-Z]/);
    expect(parts[3]).toMatch(/[0-9]$/);
  });
  it('uses words from the list by default', () => {
    for (const w of generatePassphrase().split('-')) expect(EFF_WORDLIST).toContain(w);
  });
  it('validates word count', () => {
    expect(() => generatePassphrase({ words: 2 })).toThrow(RangeError);
    expect(() => generatePassphrase({ words: 11 })).toThrow(RangeError);
  });
});
