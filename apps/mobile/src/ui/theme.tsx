import { colors, radius, spacing } from '@voult/ui-tokens';
import { useColorScheme } from 'react-native';
import { useApp } from '../lib/app-store';

export type Palette = (typeof colors)['light'] | (typeof colors)['dark'];

export function useTheme(): { c: Palette; dark: boolean; s: typeof spacing; r: typeof radius } {
  const system = useColorScheme();
  const pref = useApp((s) => s.settings.theme);
  const dark = pref === 'dark' || (pref === 'system' && system === 'dark');
  return { c: dark ? colors.dark : colors.light, dark, s: spacing, r: radius };
}
