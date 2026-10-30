import {
  generatePassphrase,
  generatePassword,
  type PassphraseOptions,
  type RandomOptions,
} from '@voult/core';
import { Copy, RefreshCw, Plus, ScanLine } from 'lucide-react';
import type { Totp } from '@voult/core';
import { useMemo, useState } from 'react';
import { TotpCode } from '../components/Totp';
import { Button, Empty, Field, IconButton, Input } from '../components/ui';
import { copySecret } from '../lib/clipboard';
import { useNav } from '../lib/nav';
import { matchesText } from '../lib/search';
import { scanActiveTab } from '../lib/qr';
import { saveItem } from '../lib/vault';
import { useAsyncAction } from '../lib/hooks';
import type { ItemView } from '../lib/vault';

export function Generator() {
  const [mode, setMode] = useState<'random' | 'passphrase'>('random');
  const [random, setRandom] = useState<RandomOptions>({
    length: 20,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
  });
  const [phrase, setPhrase] = useState<PassphraseOptions>({
    words: 5,
    separator: '-',
    capitalize: false,
    appendDigit: false,
  });
  const [nonce, setNonce] = useState(0);

  const value = useMemo(() => {
    void nonce;
    try {
      return mode === 'random' ? generatePassword(random) : generatePassphrase(phrase);
    } catch {
      return '';
    }
  }, [mode, random, phrase, nonce]);

  const check = (
    label: string,
    key: 'upper' | 'lower' | 'digits' | 'symbols' | 'excludeAmbiguous',
  ) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={random[key]}
        onChange={(e) => setRandom({ ...random, [key]: e.target.checked })}
      />{' '}
      {label}
    </label>
  );

  return (
    <div className="fade-in flex-1 space-y-4 overflow-auto p-4">
      <div className="flex gap-2 rounded-lg border border-border bg-surface p-3">
        <output data-testid="generated" className="min-w-0 flex-1 font-mono text-base break-all">
          {value || 'Select at least one option'}
        </output>
        <IconButton label="Regenerate" onClick={() => setNonce(nonce + 1)}>
          <RefreshCw size={16} />
        </IconButton>
        <IconButton label="Copy generated password" onClick={() => value && void copySecret(value)}>
          <Copy size={16} />
        </IconButton>
      </div>
      <div className="flex gap-1 text-xs" role="tablist">
        {(['random', 'passphrase'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 ${mode === m ? 'bg-primary text-primary-fg' : 'bg-surface'}`}
          >
            {m === 'random' ? 'Random' : 'Passphrase'}
          </button>
        ))}
      </div>
      {mode === 'random' ? (
        <div className="space-y-3">
          <Field label={`Length: ${random.length}`}>
            {(id) => (
              <input
                id={id}
                type="range"
                min={4}
                max={64}
                value={random.length}
                onChange={(e) => setRandom({ ...random, length: Number(e.target.value) })}
                className="w-full"
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {check('A–Z', 'upper')}
            {check('a–z', 'lower')}
            {check('0–9', 'digits')}
            {check('!@#$', 'symbols')}
          </div>
          {check('Exclude ambiguous (Il1O0)', 'excludeAmbiguous')}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={`Words: ${phrase.words}`}>
            {(id) => (
              <input
                id={id}
                type="range"
                min={3}
                max={10}
                value={phrase.words}
                onChange={(e) => setPhrase({ ...phrase, words: Number(e.target.value) })}
                className="w-full"
              />
            )}
          </Field>
          <Field label="Separator">
            {(id) => (
              <Input
                id={id}
                maxLength={3}
                value={phrase.separator}
                onChange={(e) => setPhrase({ ...phrase, separator: e.target.value })}
              />
            )}
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={phrase.capitalize}
              onChange={(e) => setPhrase({ ...phrase, capitalize: e.target.checked })}
            />{' '}
            Capitalise
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={phrase.appendDigit}
              onChange={(e) => setPhrase({ ...phrase, appendDigit: e.target.checked })}
            />{' '}
            Append a digit
          </label>
        </div>
      )}
    </div>
  );
}

function ScanResult({
  found,
  vaultId,
  onDone,
}: {
  found: Totp[];
  vaultId: string;
  onDone: () => void;
}) {
  const { busy, error, run } = useAsyncAction();
  return (
    <div className="space-y-2 border-b border-border bg-surface p-3" role="status">
      <p className="font-medium">
        Found {found.length} code{found.length === 1 ? '' : 's'}
      </p>
      <ul className="text-xs text-muted">
        {found.map((t, i) => (
          <li key={i}>{[t.issuer, t.account].filter(Boolean).join(' · ') || 'Unnamed'}</li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              for (const t of found) {
                const now = Date.now();
                await saveItem(vaultId, {
                  type: 'totp',
                  title: t.issuer || t.account || 'Authenticator',
                  notes: '',
                  favorite: false,
                  pinned: false,
                  createdAt: now,
                  updatedAt: now,
                  totp: t,
                });
              }
              onDone();
            })
          }
        >
          Add {found.length > 1 ? 'all' : ''}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function Authenticator({ items, vaultId }: { items: ItemView[]; vaultId?: string }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Totp[] | null>(null);
  const scan = useAsyncAction();
  const { setTab, open } = useNav();
  const rows = useMemo(
    () =>
      items
        .filter((v) => v.deletedAt === null)
        .flatMap((v) => {
          const i = v.item;
          if (i.type === 'totp') return [{ v, totp: i.totp }];
          if (i.type === 'login' && i.totp) return [{ v, totp: i.totp }];
          return [];
        })
        .filter((r) => matchesText(r.v, text))
        .sort((a, b) => a.v.item.title.localeCompare(b.v.item.title)),
    [items, text],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-border p-3">
        <Input
          type="search"
          aria-label="Search codes"
          placeholder="Search codes"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          variant="secondary"
          aria-label="Scan QR code on this page"
          title="Scan QR code on this page"
          className="w-9 px-0"
          disabled={scan.busy}
          onClick={() => void scan.run(async () => setFound(await scanActiveTab()))}
        >
          <ScanLine size={18} />
        </Button>
        <Button
          aria-label="Add 2FA code"
          className="w-9 px-0"
          onClick={() => {
            setTab('vault');
            open({ name: 'new', type: 'totp' });
          }}
        >
          <Plus size={18} />
        </Button>
      </div>
      {scan.error && (
        <p role="alert" className="border-b border-border p-3 text-xs text-danger">
          {scan.error}
        </p>
      )}
      {found && vaultId && (
        <ScanResult found={found} vaultId={vaultId} onDone={() => setFound(null)} />
      )}
      {rows.length === 0 ? (
        <Empty title="No 2FA codes yet" body="Add a secret key, or attach one to a login." />
      ) : (
        <ul className="flex-1 overflow-auto" aria-label="2FA codes">
          {rows.map(({ v, totp }) => (
            <li key={v.id} className="border-b border-border/60 px-4 py-3">
              <button
                className="mb-1 block max-w-full truncate text-left text-xs text-muted hover:underline"
                onClick={() => {
                  setTab('vault');
                  open({ name: 'detail', id: v.id });
                }}
              >
                {v.item.title}
                {totp.account ? ` · ${totp.account}` : ''}
              </button>
              <TotpCode entry={totp} showNext />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
