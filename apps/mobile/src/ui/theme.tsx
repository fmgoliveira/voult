import { aurora, brandGradient, colors, radius, spacing } from '@voult/ui-tokens';
import { useColorScheme } from 'react-native';
import { useApp } from '../lib/app-store';

export type Palette = (typeof colors)['light'] | (typeof colors)['dark'];

export interface Theme {
  c: Palette;
  dark: boolean;
  s: typeof spacing;
  r: typeof radius;
  /** Indigo → violet brand gradient. */
  brand: readonly [string, string];
  aurora: (typeof aurora)['light'] | (typeof aurora)['dark'];
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const pref = useApp((s) => s.settings.theme);
  const dark = pref === 'dark' || (pref === 'system' && system === 'dark');
  return {
    c: dark ? colors.dark : colors.light,
    dark,
    s: spacing,
    r: radius,
    brand: dark ? brandGradient.dark : brandGradient.light,
    aurora: dark ? aurora.dark : aurora.light,
  };
}
