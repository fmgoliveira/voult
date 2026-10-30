/**
 * Design tokens shared by the extension (Tailwind / CSS variables) and the Android app.
 *
 * The look is "soft glass": a dark-navy or lavender aurora background, translucent surfaces with a
 * hairline border, and an indigo→violet brand gradient. On the web the translucency is real
 * (`backdrop-filter`); on Android it is approximated with translucent fills over the gradient.
 */
export const colors = {
  light: {
    background: '#f4f3ff',
    surface: 'rgba(255,255,255,0.62)',
    surfaceSolid: '#ffffff',
    surfaceStrong: 'rgba(255,255,255,0.85)',
    foreground: '#171a2b',
    muted: '#626982',
    border: 'rgba(120,110,200,0.18)',
    borderStrong: 'rgba(120,110,200,0.32)',
    primary: '#5b50f0',
    primaryForeground: '#ffffff',
    accent: '#8b5cf6',
    danger: '#e11d48',
    success: '#059669',
    warning: '#d97706',
  },
  dark: {
    background: '#0b0d1a',
    surface: 'rgba(30,34,58,0.55)',
    surfaceSolid: '#161a2e',
    surfaceStrong: 'rgba(40,45,76,0.8)',
    foreground: '#f1f3ff',
    muted: '#9aa1c4',
    border: 'rgba(160,170,255,0.14)',
    borderStrong: 'rgba(160,170,255,0.28)',
    primary: '#8b85ff',
    primaryForeground: '#0b0d1a',
    accent: '#c084fc',
    danger: '#fb7185',
    success: '#34d399',
    warning: '#fbbf24',
  },
} as const;

/** Background aurora: a base gradient plus three soft colour blobs. */
export const aurora = {
  light: {
    base: ['#f7f6ff', '#eef0ff'],
    blobs: ['rgba(139,92,246,0.28)', 'rgba(56,189,248,0.24)', 'rgba(244,114,182,0.2)'],
  },
  dark: {
    base: ['#0b0d1a', '#10132a'],
    blobs: ['rgba(99,102,241,0.34)', 'rgba(14,165,233,0.2)', 'rgba(192,38,211,0.22)'],
  },
} as const;

export const brandGradient = {
  light: ['#6d5bf7', '#9b5cf6'],
  dark: ['#7c74ff', '#b07cff'],
} as const;

/** Per item type: gradient pair for the icon tile. */
export const typeColors = {
  login: ['#6366f1', '#8b5cf6'],
  note: ['#f59e0b', '#f97316'],
  card: ['#10b981', '#14b8a6'],
  identity: ['#0ea5e9', '#6366f1'],
  totp: ['#ec4899', '#f43f5e'],
} as const;

/** Stable avatar gradients for letter avatars (picked by hashing the title). */
export const avatarGradients = [
  ['#6366f1', '#8b5cf6'],
  ['#0ea5e9', '#22d3ee'],
  ['#10b981', '#84cc16'],
  ['#f59e0b', '#f97316'],
  ['#ec4899', '#f43f5e'],
  ['#8b5cf6', '#ec4899'],
  ['#14b8a6', '#0ea5e9'],
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
