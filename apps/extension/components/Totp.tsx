import { currentCode, nextCode, type Totp } from '@voult/core';
import { Copy } from 'lucide-react';
import { useMemo } from 'react';
import { copySecret } from '../lib/clipboard';
import { useNow } from '../lib/hooks';
import { IconButton } from './ui';

const group = (code: string) =>
  code.length === 6
    ? `${code.slice(0, 3)} ${code.slice(3)}`
    : code.length === 8
      ? `${code.slice(0, 4)} ${code.slice(4)}`
      : code;

export function safeCode(entry: Totp, now: number) {
  try {
    return { ...currentCode(entry, now), next: entry.kind === 'totp' ? nextCode(entry, now) : '' };
  } catch {
    return null;
  }
}

/** Countdown ring + code. Clicking the code copies it. */
export function TotpCode({
  entry,
  showNext = false,
  compact = false,
}: {
  entry: Totp;
  showNext?: boolean;
  compact?: boolean;
}) {
  const now = useNow();
  const state = useMemo(() => safeCode(entry, now), [entry, now]);
  if (!state) return <span className="text-xs text-danger">Invalid secret</span>;

  const r = 9;
  const c = 2 * Math.PI * r;
  const low = state.remaining <= 5 && entry.kind === 'totp';

  return (
    <div className="flex items-center gap-2">
      {entry.kind === 'totp' && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          role="img"
          aria-label={`${state.remaining} seconds left`}
        >
          <circle cx="12" cy="12" r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke={low ? 'var(--danger)' : 'var(--primary)'}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * state.progress}
            transform="rotate(-90 12 12)"
          />
        </svg>
      )}
      <button
        type="button"
        data-testid="totp-code"
        onClick={() => void copySecret(state.code)}
        className={`font-mono tracking-wider hover:text-primary ${compact ? 'text-base' : 'text-xl'} ${low ? 'text-danger' : ''}`}
        aria-label={`Copy code ${state.code}`}
      >
        {group(state.code)}
      </button>
      {showNext && state.next && (
        <span className="text-xs text-muted">next {group(state.next)}</span>
      )}
      <IconButton label="Copy code" onClick={() => void copySecret(state.code)}>
        <Copy size={16} />
      </IconButton>
    </div>
  );
}
