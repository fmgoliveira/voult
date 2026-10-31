/**
 * Design tokens shared by the extension (Tailwind / CSS variables) and the Android app.
 *
 * The look is calm and clean: near-white (or deep navy) backgrounds with one very faint blue glow,
 * mostly opaque surfaces with a hairline border, and a single blue accent.
 */
export const colors = {
  light: {
    background: '#f5f7fb',
    surface: '#ffffff',
    surfaceSolid: '#ffffff',
    surfaceStrong: '#ffffff',
    foreground: '#0f172a',
    muted: '#586579',
    border: 'rgba(15,23,42,0.09)',
    borderStrong: 'rgba(15,23,42,0.18)',
    primary: '#2563eb',
    primaryForeground: '#ffffff',
    accent: '#0ea5e9',
    danger: '#dc2626',
    success: '#047857',
    warning: '#b45309',
  },
  dark: {
    background: '#0b1120',
    surface: '#131b2e',
    surfaceSolid: '#131b2e',
    surfaceStrong: '#18223a',
    foreground: '#e8edf7',
    muted: '#8b97b1',
    border: 'rgba(148,163,200,0.14)',
    borderStrong: 'rgba(148,163,200,0.26)',
    primary: '#4f8cff',
    primaryForeground: '#071226',
    accent: '#38bdf8',
    danger: '#f87171',
    success: '#34d399',
    warning: '#fbbf24',
  },
} as const;

/** Background: a flat base with one faint blue glow at the top. */
export const aurora = {
  light: {
    base: ['#f5f7fb', '#f5f7fb'],
    blobs: ['rgba(37,99,235,0.07)', 'rgba(14,165,233,0)', 'rgba(14,165,233,0)'],
  },
  dark: {
    base: ['#0b1120', '#0b1120'],
    blobs: ['rgba(79,140,255,0.10)', 'rgba(56,189,248,0)', 'rgba(56,189,248,0)'],
  },
} as const;

export const brandGradient = {
  light: ['#2f6df0', '#2563eb'],
  dark: ['#5b95ff', '#3b78f5'],
} as const;

/** Per item type: gradient pair for the icon tile. */
export const typeColors = {
  login: ['#3b82f6', '#2563eb'],
  note: ['#f59e0b', '#f08a0b'],
  card: ['#10b981', '#0ea371'],
  identity: ['#0ea5e9', '#0b8fcb'],
  totp: ['#8b5cf6', '#7646e0'],
} as const;

/** Stable avatar gradients for letter avatars (picked by hashing the title). */
export const avatarGradients = [
  ['#3b82f6', '#2563eb'],
  ['#0ea5e9', '#0b8fcb'],
  ['#10b981', '#0ea371'],
  ['#f59e0b', '#e8890b'],
  ['#ef6a8a', '#e04a72'],
  ['#8b5cf6', '#7646e0'],
  ['#14b8a6', '#0e9a8c'],
] as const;

export function avatarGradient(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarGradients[h % avatarGradients.length]!;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32 } as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 24, full: 9999 } as const;

export const typeScale = {
  xs: { size: 12, line: 16 },
  sm: { size: 14, line: 20 },
  base: { size: 16, line: 24 },
  lg: { size: 18, line: 28 },
  xl: { size: 22, line: 30 },
  '2xl': { size: 28, line: 36 },
} as const;
