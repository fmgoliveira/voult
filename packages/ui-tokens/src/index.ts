/** Design tokens shared by Tailwind (extension) and NativeWind (Android). */
export const colors = {
  light: {
    background: '#ffffff',
    surface: '#f5f6f8',
    foreground: '#14161a',
    muted: '#5b6270',
    border: '#e1e4ea',
    primary: '#4f46e5',
    primaryForeground: '#ffffff',
    danger: '#dc2626',
  },
  dark: {
    background: '#0f1115',
    surface: '#181b21',
    foreground: '#f2f4f8',
    muted: '#9aa3b2',
    border: '#2a2f39',
    primary: '#818cf8',
    primaryForeground: '#0f1115',
    danger: '#f87171',
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, full: 9999 } as const;

export const typeScale = {
  xs: { size: 12, line: 16 },
  sm: { size: 14, line: 20 },
  base: { size: 16, line: 24 },
  lg: { size: 18, line: 28 },
  xl: { size: 22, line: 30 },
  '2xl': { size: 28, line: 36 },
} as const;
