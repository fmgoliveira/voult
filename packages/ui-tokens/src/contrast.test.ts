import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { colors } from './index';

describe('WCAG 2.1 AA contrast (4.5:1 for text)', () => {
  for (const mode of ['light', 'dark'] as const) {
    const c = colors[mode];
    const pairs: [string, string, string][] = [
      ['foreground', c.foreground, c.background],
      ['foreground on surface', c.foreground, c.surface],
      ['muted', c.muted, c.background],
      ['muted on surface', c.muted, c.surface],
      ['muted on strong surface', c.muted, c.surfaceStrong],
      ['button label', c.primaryForeground, c.primary],
      ['link', c.primary, c.background],
      ['link on surface', c.primary, c.surface],
      ['danger', c.danger, c.background],
      ['danger on surface', c.danger, c.surface],
      ['success', c.success, c.surface],
      ['warning', c.warning, c.surface],
    ];
    for (const [name, fg, bg] of pairs) {
      it(`${mode}: ${name}`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
