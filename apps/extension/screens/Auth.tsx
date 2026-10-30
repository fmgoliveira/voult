import { useState } from 'react';
import { Button, ErrorText, Field, Input, Logo } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAsyncAction } from '../lib/hooks';
import { buildRecoveryKitPdf, downloadBytes } from '../lib/recovery-kit';
import { DEFAULT_SERVER_URL } from '../lib/settings';
import {
  confirmRecoveryKit,
  createNewAccount,
  reauthenticate,
  signIn,
  signOut,
  unlockWithPassword,
  unlockWithPin,
  WrongPasswordError,
} from '../lib/vault';

const MIN_PASSWORD = 12;

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="fade-in flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Logo size={40} />
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </main>
  );
}

const friendly = (e: unknown): string => {
  if (e instanceof WrongPasswordError) return 'Wrong password.';
  if (e instanceof ApiError) {
    if (e.code === 'signup_closed') return 'Signup is closed on this server.';
    if (e.code === 'email_taken') return 'That email already has an account.';
    if (e.code === 'rate_limited') return 'Too many attempts. Try again in a minute.';
    if (e.code === 'invalid_credentials') return 'Wrong email or password.';
    return `Server error (${e.code}).`;
  }
  if (e instanceof TypeError) return 'Cannot reach the server. Check the URL and your connection.';
  return e instanceof Error ? e.message : 'Something went wrong.';
};

export function Welcome() {
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const { busy, error, run, setError } = useAsyncAction();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === 'create') {
        if (password.length < MIN_PASSWORD)
          throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
        if (password !== confirm) throw new Error('Passwords do not match.');
        await createNewAccount({ email, password, serverUrl });
      } else {
        await signIn({ email, password, serverUrl });
      }
    }, friendly);
  };

  return (
    <Shell
      title={mode === 'create' ? 'Create your vault' : 'Sign in'}
      subtitle="Zero-knowledge: your master password never leaves this device."
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Master password"
          hint={
            mode === 'create'
              ? `At least ${MIN_PASSWORD} characters. It cannot be reset.`
              : undefined
          }
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        {mode === 'create' && (
          <Field label="Confirm master password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
        )}
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Server</summary>
          <div className="pt-2">
            <Field label="Server URL">
              {(id) => (
                <Input
                  id={id}
                  type="url"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                />
              )}
            </Field>
          </div>
        </details>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Working…' : mode === 'create' ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <button
        type="button"
        className="text-center text-xs text-primary underline"
        onClick={() => {
          setError(null);
          setMode(mode === 'create' ? 'signin' : 'create');
        }}
      >
        {mode === 'create' ? 'I already have an account' : 'Create a new account'}
      </button>
    </Shell>
  );
}

export function RecoveryKit({
  secret,
  email,
  serverUrl,
}: {
  secret: string | null;
  email: string;
  serverUrl: string;
}) {
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAsyncAction();

  const download = () =>
    void run(async () => {
      if (!secret) return;
      downloadBytes(
        await buildRecoveryKitPdf({ email, serverUrl, recoverySecret: secret }),
        'voult-recovery-kit.pdf',
      );
    });

  return (
    <Shell
      title="Save your recovery kit"
      subtitle="You need it if you ever forget your master password."
    >
      {secret ? (
        <div className="space-y-3">
          <p
            data-testid="recovery-secret"
            className="select-all rounded-lg border border-border bg-surface p-3 text-center font-mono text-sm tracking-wider break-all"
          >
            {secret}
          </p>
          <Button variant="secondary" className="w-full" onClick={download} disabled={busy}>
            Download recovery kit (PDF)
          </Button>
          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          The secret key is only shown once, right after signup. If you did not save it, you can
          still continue with your master password.
        </p>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        <span>
          I stored my recovery kit somewhere safe. I understand Voult cannot reset my password.
        </span>
      </label>
      <Button disabled={!saved} onClick={() => void confirmRecoveryKit()}>
        Continue
      </Button>
    </Shell>
  );
}

export function Unlock({
  email,
  pin,
  pinEnabled,
}: {
  email: string;
  pin: boolean;
  pinEnabled: boolean;
}) {
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [usePin, setUsePin] = useState(pin);
  const { busy, error, run, setError } = useAsyncAction();

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => unlockWithPassword(password, newPin || undefined), friendly);
  };
  const submitPin = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await unlockWithPin(pinCode);
      if (!r.ok) {
        setPinCode('');
        throw new Error(
          r.attemptsLeft > 0
            ? `Wrong PIN. ${r.attemptsLeft} attempts left.`
            : 'Too many attempts. Use your master password.',
        );
      }
    });
    if (!pin) setUsePin(false);
  };

  return (
    <Shell title="Vault locked" subtitle={email}>
      {usePin && pin ? (
        <form onSubmit={submitPin} className="space-y-3">
          <Field label="PIN">
            {(id) => (
              <Input
                id={id}
                type="password"
                inputMode="numeric"
                autoFocus
                autoComplete="off"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
              />
            )}
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" disabled={busy || !pinCode}>
            Unlock
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-primary underline"
            onClick={() => {
              setError(null);
              setUsePin(false);
            }}
          >
            Use master password
          </button>
        </form>
      ) : (
        <form onSubmit={submitPassword} className="space-y-3">
          <Field label="Master password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {pinEnabled && (
            <Field
              label="Quick-unlock PIN (optional)"
              hint="Kept in memory only; cleared when the browser closes."
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                />
              )}
            </Field>
          )}
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" disabled={busy || !password}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
      )}
      <button
        type="button"
        className="text-center text-xs text-muted underline"
        onClick={() =>
          confirm('Sign out and remove local data from this browser?') && void signOut()
        }
      >
        Sign out
      </button>
    </Shell>
  );
}

export function Reauth({ email }: { email: string }) {
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAsyncAction();
  return (
    <Shell
      title="Session expired"
      subtitle={`Sign in again as ${email}. Your local changes are kept.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => reauthenticate(password), friendly);
        }}
        className="space-y-3"
      >
        <Field label="Master password">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy || !password}>
          Sign in
        </Button>
      </form>
      <button
        type="button"
        className="text-center text-xs text-muted underline"
        onClick={() => confirm('Sign out and discard unsynced changes?') && void signOut()}
      >
        Sign out
      </button>
    </Shell>
  );
}
