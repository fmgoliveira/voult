import { KeyRound, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { ErrorText, Input, Logo, OtpInput } from '../../components/ui';
import { useAsyncAction, useActivityAndTheme, useSettings } from '../../lib/hooks';
import type { UnlockResult } from '../../lib/bg/prompt-types';

/**
 * The "unlock" row of the in-page autofill list. It is an extension page inside an iframe so that
 * what you type (the PIN or master password) can never be seen by the website's scripts.
 */
export function UnlockFrame() {
  const settings = useSettings();
  useActivityAndTheme(settings?.theme);
  const [pin, setPin] = useState<boolean | null>(null);
  const [usePin, setUsePin] = useState(true);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run, setError } = useAsyncAction();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'unlock:status' })
      .then((r: { pin: boolean } | null) => setPin(r?.pin ?? false))
      .catch(() => setPin(false));
  }, []);

  // Escape gives the focus back to the page and closes the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void browser.runtime.sendMessage({ type: 'unlock:close' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The page keeps focus while typing normally; ArrowDown (or a click) moves it in here.
  useEffect(() => {
    const focusInput = () => root.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && (e.data as { voult?: string } | null)?.voult === 'focus')
        focusInput();
    };
    window.addEventListener('focus', focusInput);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('focus', focusInput);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const submitPin = (c: string) =>
    void run(async () => {
      const r = (await browser.runtime.sendMessage({ type: 'unlock:pin', pin: c })) as UnlockResult;
      if (r?.ok) return; // the background tells the page; this box is about to close
      setCode('');
      if (r && 'error' in r) throw new Error(r.error);
      const left = r && 'attemptsLeft' in r ? r.attemptsLeft : 0;
      if (left === 0) setPin(false);
      throw new Error(
        left > 0
          ? `Wrong PIN. ${left} attempts left.`
          : 'Too many attempts. Use your master password.',
      );
    });

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = (await browser.runtime.sendMessage({
        type: 'unlock:password',
        password,
      })) as UnlockResult;
      if (r?.ok) return;
      setPassword('');
      throw new Error(r && 'error' in r ? r.error : 'Could not unlock.');
    });
  };

  const pinMode = pin === true && usePin;

  return (
    <main
      ref={root}
      className="box-border flex h-screen flex-col gap-3 rounded-2xl border border-border-strong p-4"
    >
      <div className="flex items-center gap-2.5">
        <Logo size={26} />
        <div className="leading-tight">
          <h1 className="text-sm font-extrabold tracking-tight">Voult is locked</h1>
          <p className="text-[11px] text-muted">
            {busy
              ? 'Checking…'
              : pinMode
                ? 'Enter your PIN to see your logins'
                : 'Enter your master password'}
          </p>
        </div>
      </div>
      {pin === null ? null : pinMode ? (
        <>
          <OtpInput
            label="PIN"
            value={code}
            onChange={setCode}
            onComplete={submitPin}
            disabled={busy}
          />
          <ErrorText>{error}</ErrorText>
          <button
            type="button"
            className="text-center text-xs font-semibold text-primary hover:underline"
            onClick={() => {
              setError(null);
              setUsePin(false);
            }}
          >
            Use master password
          </button>
        </>
      ) : (
        <form onSubmit={submitPassword} className="space-y-2">
          <Input
            aria-label="Master password"
            type="password"
            autoComplete="current-password"
            leading={<Lock size={15} />}
            placeholder="Master password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <ErrorText>{error}</ErrorText>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">Press Enter to unlock</span>
            {pin === true && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                onClick={() => {
                  setError(null);
                  setUsePin(true);
                }}
              >
                <KeyRound size={12} /> Use PIN
              </button>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
