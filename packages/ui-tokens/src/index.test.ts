import { describe, expect, it } from 'vitest';
import { colors } from './index';

describe('ui-tokens', () => {
  it('defines the same keys for light and dark', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  });
});
