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
import {
  Button,
  Empty,
  Field,
  IconButton,
  Input,
  Checkbox,
  ItemAvatar,
  Pills,
  SearchInput,
} from '../components/ui';
import { copySecret } from '../lib/clipboard';
import { useNav } from '../lib/nav';
import { matchesText } from '@voult/core';
import { scanActiveTab } from '../lib/qr';
import { saveItem } from '../lib/vault';
import { useAsyncAction } from '../lib/hooks';
import type { ItemView } from '../lib/vault';

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Checkbox
      checked={checked}
      onChange={onChange}
      className={`glass w-full items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
        checked ? 'border-primary/50 bg-primary/10' : ''
      }`}
    >
      {children}
    </Checkbox>
  );
}

/** Colour digits and symbols so a generated password is easy to read aloud and verify. */
function Colored({ value }: { value: string }) {
  return (
    <>
      {[...value].map((ch, i) => (
        <span
          key={i}
          className={
            /[0-9]/.test(ch) ? 'text-primary' : /[^A-Za-z0-9]/.test(ch) ? 'text-accent' : ''
          }
        >
          {ch}
        </span>
      ))}
    </>
  );
}

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
    <Toggle checked={random[key]} onChange={(v) => setRandom({ ...random, [key]: v })}>
      {label}
    </Toggle>
  );

  return (
    <div className="fade-in flex-1 space-y-4 overflow-auto p-4">
      <div className="glass-strong flex items-start gap-1 rounded-2xl p-3.5">
        <output
          data-testid="generated"
          className="min-w-0 flex-1 py-1 font-mono text-[15px] leading-relaxed font-medium break-all"
        >
          {value ? <Colored value={value} /> : 'Select at least one option'}
        </output>
        <IconButton label="Regenerate" onClick={() => setNonce(nonce + 1)}>
          <RefreshCw size={16} />
        </IconButton>
        <IconButton label="Copy generated password" onClick={() => value && void copySecret(value)}>
          <Copy size={16} />
        </IconButton>
      </div>
      <Pills
        label="Generator type"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'random', label: 'Random' },
          { value: 'passphrase', label: 'Passphrase' },
        ]}
      />
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
                className="w-full accent-[var(--primary)]"
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
                className="w-full accent-[var(--primary)]"
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
          <Toggle
            checked={phrase.capitalize}
            onChange={(v) => setPhrase({ ...phrase, capitalize: v })}
          >
            Capitalise
          </Toggle>
          <Toggle
            checked={phrase.appendDigit}
            onChange={(v) => setPhrase({ ...phrase, appendDigit: v })}
          >
            Append a digit
          </Toggle>
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
    <div className="glass-strong mx-4 mb-2 space-y-2 rounded-2xl p-3.5" role="status">
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
      <div className="flex gap-2 px-4 pb-2">
        <SearchInput
          aria-label="Search codes"
          placeholder="Search codes"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          variant="secondary"
          aria-label="Scan QR code on this page"
          title="Scan QR code on this page"
          className="size-10 shrink-0 px-0"
          disabled={scan.busy}
          onClick={() => void scan.run(async () => setFound(await scanActiveTab()))}
        >
          <ScanLine size={18} />
        </Button>
        <Button
          aria-label="Add 2FA code"
          className="size-10 shrink-0 px-0"
          onClick={() => {
            setTab('vault');
            open({ name: 'new', type: 'totp' });
          }}
        >
          <Plus size={18} />
        </Button>
      </div>
      {scan.error && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
        >
          {scan.error}
        </p>
      )}
      {found && vaultId && (
        <ScanResult found={found} vaultId={vaultId} onDone={() => setFound(null)} />
      )}
      {rows.length === 0 ? (
        <Empty
          title="No 2FA codes yet"
          body="Scan a QR code, add a secret key, or attach one to a login."
          icon={ScanLine}
        />
      ) : (
        <ul className="flex-1 space-y-2 overflow-auto px-4 pb-3" aria-label="2FA codes">
          {rows.map(({ v, totp }) => (
            <li key={v.id} className="glass rounded-2xl p-3">
              <button
                className="mb-1.5 flex max-w-full items-center gap-2 truncate text-left text-xs font-semibold text-muted hover:text-fg"
                onClick={() => {
                  setTab('vault');
                  open({ name: 'detail', id: v.id });
                }}
              >
                <ItemAvatar
                  type={v.item.type}
                  title={v.item.title}
                  size={22}
                  urls={v.item.type === 'login' ? v.item.urls : undefined}
                />
                <span className="truncate">
                  {v.item.title}
                  {totp.account ? ` · ${totp.account}` : ''}
                </span>
              </button>
              <TotpCode entry={totp} showNext />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
