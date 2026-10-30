import clsx from 'clsx';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { forwardRef, useId } from 'react';

export function Button({
  variant = 'primary',
  className,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-primary-fg hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-surface hover:bg-border/50',
        variant === 'ghost' && 'hover:bg-surface',
        variant === 'danger' && 'bg-danger text-white hover:opacity-90',
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...p}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors',
        'hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...p }, ref) {
    return (
      <input
        ref={ref}
        {...p}
        className={clsx(
          'h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm placeholder:text-muted',
          'focus-visible:outline-2 focus-visible:outline-primary',
          className,
        )}
      />
    );
  },
);

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={clsx(
        'h-9 rounded-lg border border-border bg-bg px-2 text-sm focus-visible:outline-2 focus-visible:outline-primary',
        className,
      )}
    />
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-primary',
        checked ? 'bg-primary' : 'bg-border',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 size-4 rounded-full bg-white transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs text-danger">
      {children}
    </p>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="text-xs text-muted">{body}</p>}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path
        d="M9 11l7 11 7-11"
        stroke="var(--primary-fg)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
