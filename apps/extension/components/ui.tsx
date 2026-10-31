import { avatarGradient, typeColors } from '@voult/ui-tokens';
import { faviconUrl, type ItemType } from '@voult/core';
import { useT } from '../lib/i18n';
import { inToolbarPopup, openInWindow } from '../lib/window';
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
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
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
        variant === 'danger' && 'bg-danger text-primary-fg hover:brightness-110',
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
          'h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg',
          'transition-colors placeholder:text-muted/80',
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

interface SelectOption {
  value: string;
  label: ReactNode;
}

/**
 * Themed dropdown. Same call shape as a native <select> (children are <option>s and onChange gets
 * `e.target.value`), but rendered by us so it matches the rest of the UI.
 */
export function Select({
  className,
  children,
  value,
  onChange,
  id,
  disabled,
  'aria-label': ariaLabel,
}: {
  className?: string;
  children: ReactNode;
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const options: SelectOption[] = [];
  Children.forEach(children, (c) => {
    if (isValidElement<{ value?: string | number; children?: ReactNode }>(c))
      options.push({ value: String(c.props.value ?? ''), label: c.props.children });
  });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number }>();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.findIndex((o) => o.value === String(value));

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    const need = Math.min(options.length * 36 + 8, 240);
    const width = Math.max(r.width, 140);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setBox(
      room >= need || room > r.top
        ? { left, width, top: r.bottom + 4 }
        : { left, width, bottom: window.innerHeight - r.top + 4 },
    );
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    // Only an outside press closes it: browser popups fire spurious blur/resize events while
    // they open, which used to shut the list the moment it appeared.
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange({ target: { value: o.value } });
    setOpen(false);
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setActive(Math.max(selected, 0));
        setOpen(true);
      } else {
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((a) => (a + d + options.length) % options.length);
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      pick(active);
    }
  };

  return (
    <div className="relative">
      <button
        ref={btn}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setActive(Math.max(selected, 0));
          setOpen(!open);
        }}
        onKeyDown={onKey}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface pr-2.5 pl-3 text-left text-sm text-fg',
          'transition-colors hover:border-border-strong focus-visible:border-primary',
          'focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-0 disabled:opacity-50',
          open && 'border-primary',
          className,
        )}
      >
        <span className="truncate">{options[selected]?.label ?? ''}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open &&
        box &&
        createPortal(
          <ul
            ref={list}
            role="listbox"
            aria-label={ariaLabel}
            style={{ position: 'fixed', zIndex: 100, maxHeight: 240, ...box }}
            className="glass-strong pop-in overflow-auto rounded-xl bg-surface-solid p-1"
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={i === selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={cn(
                  'flex h-8 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 text-sm',
                  i === active && 'bg-primary/10',
                  i === selected && 'font-semibold text-primary',
                )}
              >
                <span className="truncate">{o.label}</span>
                {i === selected && <Check size={14} />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

/** Themed checkbox. The whole row is the click target; `children` is its label. */
export function Checkbox({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('group flex items-start gap-2.5 text-left', className)}
    >
      <span
        className={cn(
          'mt-px grid size-[18px] shrink-0 place-items-center rounded-md border transition-colors',
          'group-focus-visible:ring-2 group-focus-visible:ring-primary/40',
          checked
            ? 'border-primary bg-primary text-primary-fg'
            : 'border-border-strong bg-surface group-hover:border-primary/60',
        )}
      >
        {checked && <Check size={13} strokeWidth={3} className="pop-in" />}
      </span>
      <span>{children}</span>
    </button>
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
        checked ? 'brand-bg border-transparent' : 'bg-border-strong',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all duration-200',
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
            value === o.value ? 'brand-bg' : 'text-muted hover:text-fg',
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
      <div className="glass grid size-16 place-items-center rounded-3xl text-primary">
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
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
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
      className="grid shrink-0 place-items-center rounded-xl text-white"
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

/** Whether to fetch site icons (a setting; App keeps it in sync). */
export const useIconPref = create<{ on: boolean }>(() => ({ on: true }));

const brokenIcons = new Set<string>();

/**
 * Logins show the website's own icon (fetched straight from that site, never via a third party)
 * and fall back to a coloured letter. Other types get an icon tile.
 */
export function ItemAvatar({
  type,
  title,
  size = 40,
  urls,
}: {
  type: ItemType;
  title: string;
  size?: number;
  urls?: readonly { url: string }[];
}) {
  const iconsOn = useIconPref((s) => s.on);
  const src = iconsOn && urls ? faviconUrl(urls) : null;
  const [ok, setOk] = useState(false);
  const [failed, setFailed] = useState(() => (src ? brokenIcons.has(src) : false));
  if (type !== 'login' || !title.trim()) return <TypeTile type={type} size={size} />;
  const [from, to] = avatarGradient(title.toLowerCase());
  return (
    <span
      aria-hidden
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-xl font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {title.trim()[0]!.toUpperCase()}
      {src && !failed && (
        <span
          className="absolute inset-0 grid place-items-center bg-white transition-opacity"
          style={{ opacity: ok ? 1 : 0 }}
        >
          <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            draggable={false}
            style={{ width: size * 0.62, height: size * 0.62, objectFit: 'contain' }}
            onLoad={(e) => {
              // Some sites answer 200 with a 0/1px placeholder.
              if (e.currentTarget.naturalWidth > 1) setOk(true);
              else {
                brokenIcons.add(src);
                setFailed(true);
              }
            }}
            onError={() => {
              brokenIcons.add(src);
              setFailed(true);
            }}
          />
        </span>
      )}
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

export const PIN_LENGTH = 6;

/** Six-slot code input. Typing the last digit calls `onComplete`; there is no submit button. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
  mask = true,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Show dots instead of the digits. */
  mask?: boolean;
  label: string;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={cn('relative mx-auto flex w-fit gap-2', disabled && 'opacity-50')}
      onClick={() => input.current?.focus()}
    >
      {Array.from({ length: PIN_LENGTH }, (_, i) => {
        const active = focused && i === Math.min(value.length, PIN_LENGTH - 1);
        const ch = value[i];
        return (
          <div
            key={i}
            aria-hidden
            className={cn(
              'grid h-12 w-10 place-items-center rounded-xl border bg-surface text-lg font-semibold transition-colors',
              active ? 'border-primary ring-2 ring-primary/30' : 'border-border-strong',
            )}
          >
            {ch ? mask ? <span className="size-2.5 rounded-full bg-fg" /> : ch : null}
          </div>
        );
      })}
      <input
        ref={input}
        aria-label={label}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={PIN_LENGTH}
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
          onChange(v);
          if (v.length === PIN_LENGTH) onComplete?.(v);
        }}
        // Invisible, but covers the slots so a click anywhere on them focuses it.
        className="absolute inset-0 h-full w-full cursor-text opacity-0 focus-visible:outline-0"
      />
    </div>
  );
}

/**
 * File input that works from the toolbar popup: browsers close the popup when the file dialog
 * opens, so there it offers to reopen the same UI in a window first.
 */
export function FileInput({
  id,
  accept,
  onFile,
}: {
  id?: string;
  accept: string;
  onFile: (f: File | undefined) => void;
}) {
  const t = useT();
  if (inToolbarPopup())
    return (
      <Button variant="secondary" className="w-full" onClick={() => void openInWindow()}>
        {t('common.openWindow')}
      </Button>
    );
  return (
    <input
      id={id}
      type="file"
      accept={accept}
      onChange={(e) => onFile(e.target.files?.[0])}
      className="w-full text-xs"
    />
  );
}
