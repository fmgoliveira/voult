import { avatarGradient, typeColors } from '@voult/ui-tokens';
import type { ItemType } from '@voult/core';
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Check,
  ChevronDown,
  CreditCard,
  Globe,
  IdCard,
  Search,
  ShieldCheck,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { forwardRef, useId } from 'react';
import { create } from 'zustand';

/** Class names with Tailwind conflicts resolved (so `px-0` really overrides `px-4`). */
const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ------------------------------------------------------------------ buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  className,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-150',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' && 'brand-bg brand-glow hover:brightness-110',
        variant === 'secondary' && 'glass hover:bg-surface-strong',
        variant === 'ghost' && 'text-fg hover:bg-surface',
        variant === 'danger' &&
          'bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-[0_8px_20px_-8px_rgba(225,29,72,0.7)] hover:brightness-110',
        className,
      )}
    >
      {children}
    </button>
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
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition-all duration-150',
        'hover:bg-surface-strong hover:text-fg active:scale-90 disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ inputs

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }
>(function Input({ className, leading, ...p }, ref) {
  return (
    <div className="relative w-full">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-muted">
          {leading}
        </span>
      )}
      <input
        ref={ref}
        {...p}
        className={cn(
          'h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg shadow-sm',
          'backdrop-blur-md transition-colors placeholder:text-muted/80',
          'hover:border-border-strong focus-visible:border-primary focus-visible:outline-0',
          'focus-visible:ring-2 focus-visible:ring-primary/30',
          leading && 'pl-9',
          className,
        )}
      />
    </div>
  );
});

export function SearchInput(p: InputHTMLAttributes<HTMLInputElement>) {
  return <Input type="search" leading={<Search size={16} />} {...p} />;
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...p}
        className={cn(
          'h-10 w-full appearance-none rounded-xl border border-border bg-surface pr-8 pl-3 text-sm text-fg',
          'backdrop-blur-md transition-colors hover:border-border-strong focus-visible:border-primary',
          'focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-0',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      />
    </div>
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
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold tracking-wide text-muted">
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
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors duration-200',
        checked ? 'brand-bg brand-glow border-transparent' : 'bg-surface-strong',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow-md transition-all duration-200',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function Pills<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="glass inline-flex rounded-xl p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg px-3 py-1 text-xs font-semibold transition-all',
            value === o.value ? 'brand-bg brand-glow' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ surfaces & feedback

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('glass rounded-2xl', className)}>{children}</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      {children}
    </p>
  );
}

export function Empty({
  title,
  body,
  icon: Icon = ShieldCheck,
}: {
  title: string;
  body?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="glass float-slow grid size-16 place-items-center rounded-3xl text-primary">
        <Icon size={28} strokeWidth={1.75} />
      </div>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {body && <p className="text-xs text-muted">{body}</p>}
      </div>
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5bf7" />
          <stop offset="1" stopColor="#b06cf7" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${id})`} />
      <path
        d="M20 8.5 29.5 12v7.2c0 5.4-3.8 9.8-9.5 12.3-5.7-2.5-9.5-6.9-9.5-12.3V12L20 8.5Z"
        fill="rgba(255,255,255,0.18)"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M16 20.5l3 3 5.5-6"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ------------------------------------------------------------------ item identity

const TYPE_ICON: Record<ItemType, LucideIcon> = {
  login: Globe,
  note: StickyNote,
  card: CreditCard,
  identity: IdCard,
  totp: ShieldCheck,
};

export const typeIcon = (t: ItemType) => TYPE_ICON[t];

/** Rounded gradient tile with the item type's icon. */
export function TypeTile({ type, size = 40 }: { type: ItemType; size?: number }) {
  const Icon = TYPE_ICON[type];
  const [from, to] = typeColors[type];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl text-white shadow-md"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      <Icon size={size * 0.48} strokeWidth={2} />
    </span>
  );
}

/** Letter avatar for logins (stable colour per title); icon tile for other types. */
export function ItemAvatar({
  type,
  title,
  size = 40,
}: {
  type: ItemType;
  title: string;
  size?: number;
}) {
  if (type !== 'login' || !title.trim()) return <TypeTile type={type} size={size} />;
  const [from, to] = avatarGradient(title.toLowerCase());
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-xl font-bold text-white shadow-md"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {title.trim()[0]!.toUpperCase()}
    </span>
  );
}

// ------------------------------------------------------------------ toasts

interface ToastState {
  message: string | null;
  show(message: string): void;
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const useToast = create<ToastState>((set) => ({
  message: null,
  show(message) {
    clearTimeout(toastTimer);
    set({ message });
    toastTimer = setTimeout(() => set({ message: null }), 1800);
  },
}));

export function Toaster() {
  const message = useToast((s) => s.message);
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-20 z-50 flex justify-center"
    >
      <div className="glass-strong pop-in flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold">
        <Check size={14} className="text-success" />
        {message}
      </div>
    </div>
  );
}
