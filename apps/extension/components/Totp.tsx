import { currentCode, nextCode, type Totp } from '@voult/core';
import { Copy } from 'lucide-react';
import { useId, useMemo } from 'react';
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

/** Circular countdown with the seconds left in the middle. */
function Ring({ remaining, progress, low }: { remaining: number; progress: number; low: boolean }) {
  const id = useId();
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      role="img"
      aria-label={`${remaining} seconds left`}
      className="shrink-0"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={low ? '#fb7185' : '#7c74ff'} />
          <stop offset="1" stopColor={low ? '#e11d48' : '#c084fc'} />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--border)" strokeWidth="3.5" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * progress}
        transform="rotate(-90 20 20)"
        style={{ transition: 'stroke-dashoffset 1s linear' }}
      />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="currentColor"
        className={low ? 'text-danger' : 'text-fg'}
      >
        {remaining}
      </text>
    </svg>
  );
}

/** Code with a countdown ring. Clicking the code copies it. */
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
  const low = state.remaining <= 5 && entry.kind === 'totp';

  return (
    <div className="flex items-center gap-3">
      {entry.kind === 'totp' && (
        <Ring remaining={state.remaining} progress={state.progress} low={low} />
      )}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          data-testid="totp-code"
          onClick={() => void copySecret(state.code)}
          className={`font-mono font-semibold tracking-[0.12em] transition-colors hover:text-primary ${
            compact ? 'text-lg' : 'text-2xl'
          } ${low ? 'text-danger' : ''}`}
          aria-label={`Copy code ${state.code}`}
        >
          {group(state.code)}
        </button>
        {showNext && state.next && (
          <div className="text-[11px] text-muted">
            next <span className="font-mono">{group(state.next)}</span>
          </div>
        )}
      </div>
      <IconButton label="Copy code" onClick={() => void copySecret(state.code)}>
        <Copy size={16} />
      </IconButton>
    </div>
  );
}
