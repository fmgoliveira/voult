import { describe, expect, it } from 'vitest';
import { aurora, avatarGradient, brandGradient, colors, typeColors } from './index';

describe('ui-tokens', () => {
  it('defines the same keys for light and dark', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
    expect(Object.keys(aurora.dark).sort()).toEqual(Object.keys(aurora.light).sort());
    expect(brandGradient.dark).toHaveLength(2);
  });
  it('has a gradient for every item type', () => {
    expect(Object.keys(typeColors).sort()).toEqual(['card', 'identity', 'login', 'note', 'totp']);
  });
  it('picks a stable avatar gradient per seed', () => {
    expect(avatarGradient('GitHub')).toEqual(avatarGradient('GitHub'));
    expect(avatarGradient('')).toHaveLength(2);
  });
});
