import { Download, KeyRound, Lock, Mail, Server, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Checkbox,
  ErrorText,
  Field,
  Input,
  Logo,
  OtpInput,
  PIN_LENGTH,
} from '../components/ui';
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
    <main className="fade-in flex h-full flex-col overflow-auto px-5 py-6">
      <div className="flex flex-col items-center gap-2.5 pb-5 text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 scale-[1.9] rounded-full bg-primary/35 blur-2xl" />
          <div>
            <Logo size={58} />
          </div>
        </div>
        <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="max-w-[270px] text-xs text-muted">{subtitle}</p>}
      </div>
      <div className="glass-strong space-y-3.5 rounded-3xl p-5">{children}</div>
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
              leading={<Mail size={15} />}
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
              leading={<Lock size={15} />}
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
                leading={<Lock size={15} />}
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
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium select-none">
            <Server size={13} /> Server
          </summary>
          <div className="pt-2">
            <Field label="Server URL">
              {(id) => (
                <Input
                  id={id}
                  leading={<Server size={15} />}
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
        className="w-full text-center text-xs font-semibold text-primary hover:underline"
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
            className="select-all rounded-2xl border border-primary/30 bg-primary/10 p-3.5 text-center font-mono text-[15px] font-semibold tracking-[0.14em] break-all"
          >
            {secret}
          </p>
          <Button variant="secondary" className="w-full" onClick={download} disabled={busy}>
            <Download size={16} /> Download recovery kit (PDF)
          </Button>
          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <p className="flex gap-2 rounded-2xl border border-border bg-surface p-3 text-xs text-muted">
          <ShieldAlert size={16} className="mt-px shrink-0" />
          The secret key is only shown once, right after signup. If you did not save it, you can
          still continue with your master password.
        </p>
      )}
      <Checkbox checked={saved} onChange={setSaved} className="text-xs leading-snug text-muted">
        I stored my recovery kit somewhere safe. I understand Voult cannot reset my password.
      </Checkbox>
      <Button className="w-full" disabled={!saved} onClick={() => void confirmRecoveryKit()}>
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
    void run(
      () => unlockWithPassword(password, newPin.length === PIN_LENGTH ? newPin : undefined),
      friendly,
    );
  };
  const submitPin = (code: string) => {
    void run(async () => {
      const r = await unlockWithPin(code);
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
        <div className="space-y-4">
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <KeyRound size={13} /> Enter your 6-digit PIN
          </p>
          <OtpInput
            label="PIN"
            value={pinCode}
            onChange={setPinCode}
            onComplete={submitPin}
            disabled={busy}
            autoFocus
          />
          <ErrorText>{error}</ErrorText>
          <button
            type="button"
            className="w-full text-center text-xs font-semibold text-primary hover:underline"
            onClick={() => {
              setError(null);
              setUsePin(false);
            }}
          >
            Use master password
          </button>
        </div>
      ) : (
        <form onSubmit={submitPassword} className="space-y-3">
          <Field label="Master password">
            {(id) => (
              <Input
                id={id}
                leading={<Lock size={15} />}
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {pinEnabled && (
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-muted">
                Quick-unlock PIN (optional, 6 digits)
              </p>
              <OtpInput label="New PIN" value={newPin} onChange={setNewPin} />
              <p className="text-center text-xs text-muted">
                Kept in memory only; cleared when the browser closes.
              </p>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" disabled={busy || !password}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
      )}
      <button
        type="button"
        className="w-full text-center text-xs text-muted hover:text-fg hover:underline"
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
              leading={<Lock size={15} />}
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
        className="w-full text-center text-xs text-muted hover:text-fg hover:underline"
        onClick={() => confirm('Sign out and discard unsynced changes?') && void signOut()}
      >
        Sign out
      </button>
    </Shell>
  );
}
