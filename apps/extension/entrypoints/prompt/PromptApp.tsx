import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Logo } from '../../components/ui';
import type { PromptDecision, PromptRequest } from '../../lib/bg/prompt-types';
import { useActivityAndTheme, useSettings } from '../../lib/hooks';

/** Passkey picker/confirmation, opened in its own small window by the background worker. */
export function PromptApp() {
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const settings = useSettings();
  useActivityAndTheme(settings?.theme);
  const [req, setReq] = useState<PromptRequest | null | undefined>(undefined);
  const [choice, setChoice] = useState('new');

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: 'prompt:get', id })
      .then((r) => setReq((r as PromptRequest | null) ?? null));
  }, [id]);

  const decide = (decision: PromptDecision) =>
    void browser.runtime.sendMessage({ type: 'prompt:decide', id, decision });

  useEffect(() => window.focus(), []);

  // Escape cancels (the prompt is a modal over the page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        void browser.runtime.sendMessage({
          type: 'prompt:decide',
          id,
          decision: { action: 'cancel' },
        });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  if (req === undefined) return <div className="p-6 text-muted">Loading…</div>;
  if (req === null)
    return (
      <div className="p-6 text-muted">This request has expired. You can close this window.</div>
    );

  return (
    <main className="fade-in flex h-screen flex-col gap-4 p-5">
      <div className="glass-strong flex items-center gap-3 rounded-2xl p-3.5">
        <Logo size={40} />
        <div className="min-w-0">
          <h1 className="text-base font-extrabold tracking-tight">
            {req.kind === 'create' ? 'Create a passkey' : 'Sign in with a passkey'}
          </h1>
          <p className="truncate text-xs text-muted">{req.host}</p>
        </div>
      </div>

      {req.kind === 'create' ? (
        <>
          <p>
            Save a passkey for <b>{req.rpName || req.rpId}</b>
            {req.userName ? (
              <>
                {' '}
                as <b>{req.userName}</b>
              </>
            ) : null}
            ?
          </p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Where to save it</legend>
            <label className="glass flex cursor-pointer items-center gap-2.5 rounded-xl p-3 has-[:checked]:border-primary/60 has-[:checked]:bg-primary/10">
              <input
                className="accent-[var(--primary)]"
                type="radio"
                name="dest"
                checked={choice === 'new'}
                onChange={() => setChoice('new')}
              />
              <span>Save as a new login</span>
            </label>
            {req.candidates.map((c) => (
              <label
                key={c.id}
                className="glass flex cursor-pointer items-center gap-2.5 rounded-xl p-3 has-[:checked]:border-primary/60 has-[:checked]:bg-primary/10"
              >
                <input
                  className="accent-[var(--primary)]"
                  type="radio"
                  name="dest"
                  checked={choice === c.id}
                  onChange={() => setChoice(c.id)}
                />
                <span className="min-w-0">
                  Add to <b className="truncate">{c.title}</b>
                  {c.username && (
                    <span className="block truncate text-xs text-muted">{c.username}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="mt-auto flex flex-col gap-2">
            <Button
              onClick={() =>
                decide(
                  choice === 'new'
                    ? { action: 'create-new' }
                    : { action: 'attach', itemId: choice },
                )
              }
            >
              Create passkey
            </Button>
            <Button variant="secondary" onClick={() => decide({ action: 'fallback' })}>
              Use browser or phone instead
            </Button>
            <Button variant="ghost" onClick={() => decide({ action: 'cancel' })}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>
            Choose an account to sign in to <b>{req.rpId}</b>.
          </p>
          <ul className="space-y-2 overflow-auto">
            {req.options.map((o) => (
              <li key={o.credentialId}>
                <button
                  data-testid="passkey-option"
                  className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all hover:-translate-y-px hover:bg-surface-strong"
                  onClick={() =>
                    decide({ action: 'use', itemId: o.itemId, credentialId: o.credentialId })
                  }
                >
                  <span className="brand-bg grid size-9 place-items-center rounded-xl">
                    <KeyRound size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{o.userName || o.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {o.title} · created {new Date(o.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="secondary" onClick={() => decide({ action: 'fallback' })}>
              Use browser or phone instead
            </Button>
            <Button variant="ghost" onClick={() => decide({ action: 'cancel' })}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
