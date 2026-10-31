import { describe, expect, it } from 'vitest';
import { passphraseEntropyBits, randomEntropyBits, strengthOf } from './generator';

describe('strength', () => {
  it('scales with length and character sets', () => {
    expect(randomEntropyBits({ length: 20 })).toBeGreaterThan(randomEntropyBits({ length: 10 }));
    expect(randomEntropyBits({ digits: false, symbols: false, upper: false })).toBeCloseTo(
      20 * Math.log2(26),
    );
    expect(randomEntropyBits({ upper: false, lower: false, digits: false, symbols: false })).toBe(
      0,
    );
  });
  it('rates passphrases by word count', () => {
    expect(passphraseEntropyBits({ words: 5 })).toBeCloseTo(5 * Math.log2(7776));
    expect(passphraseEntropyBits({ words: 5, appendDigit: true })).toBeGreaterThan(
      passphraseEntropyBits({ words: 5 }),
    );
  });
  it('buckets', () => {
    expect(strengthOf(20).label).toBe('Weak');
    expect(strengthOf(50).label).toBe('Fair');
    expect(strengthOf(70).label).toBe('Good');
    expect(strengthOf(100).label).toBe('Strong');
    expect(strengthOf(130).label).toBe('Excellent');
    expect(strengthOf(500).level).toBe(1);
  });
});
