import {
  generatePassword,
  itemSchema,
  type Item,
  type ItemType,
  type LoginItem,
} from '@voult/core';
import { Eye, EyeOff, Plus, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Button, ErrorText, Field, IconButton, Input, Select } from '../components/ui';
import { useAsyncAction } from '../lib/hooks';
import { useNav } from '../lib/nav';
import { parseTotpInput } from '../lib/totp-input';
import { saveItem, saveLoginEdit, type ItemView, type VaultView } from '../lib/vault';

const TYPE_LABEL: Record<ItemType, string> = {
  login: 'Login',
  note: 'Secure note',
  card: 'Card',
  identity: 'Identity',
  totp: '2FA code',
};
export const typeLabel = (t: ItemType) => TYPE_LABEL[t];

export function blankItem(type: ItemType): Item {
  const now = Date.now();
  const base = {
    title: '',
    notes: '',
    favorite: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  switch (type) {
    case 'login':
      return {
        ...base,
        type,
        username: '',
        email: '',
        password: '',
        urls: [],
        customFields: [],
        passkeys: [],
        passwordHistory: [],
      };
    case 'note':
      return { ...base, type };
    case 'card':
      return { ...base, type, holder: '', number: '', expiry: '', cvv: '', pin: '' };
    case 'identity':
      return {
        ...base,
        type,
        fullName: '',
        email: '',
        phone: '',
        address: '',
        birthday: '',
        customFields: [],
      };
    case 'totp':
      return {
        ...base,
        type,
        totp: {
          kind: 'totp',
          secret: '',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          counter: 0,
          issuer: '',
          account: '',
        },
      };
  }
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <Field label="Password">
      {(id) => (
        <div className="flex gap-1">
          <Input
            id={id}
            type={show ? 'text' : 'password'}
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono"
          />
          <IconButton
            label={show ? 'Hide password' : 'Show password'}
            onClick={() => setShow(!show)}
            type="button"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
          <IconButton
            label="Generate password"
            onClick={() => {
              onChange(generatePassword({ length: 20 }));
              setShow(true);
            }}
            type="button"
          >
            <Wand2 size={16} />
          </IconButton>
        </div>
      )}
    </Field>
  );
}

function Text({
  label,
  value,
  onChange,
  type = 'text',
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={mono ? 'font-mono' : ''}
        />
      )}
    </Field>
  );
}

export function Editor({
  type,
  existing,
  vaults,
}: {
  type: ItemType;
  existing?: ItemView;
  vaults: VaultView[];
}) {
  const { back, open } = useNav();
  const [draft, setDraft] = useState<Item>(() => existing?.item ?? blankItem(type));
  const [vaultId, setVaultId] = useState(existing?.vaultId ?? vaults[0]?.id ?? '');
  const [totpText, setTotpText] = useState(() => {
    const t =
      existing?.item.type === 'login'
        ? existing.item.totp
        : existing?.item.type === 'totp'
          ? existing.item.totp
          : undefined;
    return t?.secret ?? '';
  });
  const { busy, error, run, setError } = useAsyncAction();

  const patch = (p: Record<string, unknown>) => setDraft((d) => ({ ...d, ...p }) as Item);
  const d = draft as Item & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  const save = () =>
    void run(
      async () => {
        let next: Item = draft;
        if (next.type === 'login') next = { ...next, totp: parseTotpInput(totpText, next.totp) };
        if (next.type === 'totp') {
          const t = parseTotpInput(totpText, next.totp);
          if (!t) throw new Error('Enter the secret key or an otpauth:// link.');
          next = { ...next, totp: t };
        }
        if (!next.title.trim()) throw new Error('Give it a title.');
        const parsed = itemSchema.safeParse(next);
        if (!parsed.success) throw new Error('Some fields are invalid.');
        if (!vaultId) throw new Error('No vault available yet. Wait for sync to finish.');
        let id: string;
        if (existing && parsed.data.type === 'login') {
          await saveLoginEdit(existing, parsed.data);
          id = existing.id;
        } else {
          id = await saveItem(existing?.vaultId ?? vaultId, parsed.data, existing?.id);
        }
        open({ name: 'detail', id });
      },
      (e) =>
        e instanceof Error && e.message === 'recovery_kit_required'
          ? 'Confirm your recovery kit first.'
          : e instanceof Error
            ? e.message
            : 'Could not save.',
    );

  const titleText = existing
    ? `Edit ${typeLabel(draft.type).toLowerCase()}`
    : `New ${typeLabel(draft.type).toLowerCase()}`;

  return (
    <form
      className="fade-in flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (existing ? open({ name: 'detail', id: existing.id }) : back())}
        >
          Cancel
        </Button>
        <h2 className="flex-1 text-center font-medium">{titleText}</h2>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-4">
        <Text label="Title" value={draft.title} onChange={(v) => patch({ title: v })} />

        {draft.type === 'login' && (
          <>
            <Text label="Username" value={d.username} onChange={(v) => patch({ username: v })} />
            <Text
              label="Email"
              type="email"
              value={d.email}
              onChange={(v) => patch({ email: v })}
            />
            <PasswordField value={d.password} onChange={(v) => patch({ password: v })} />
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted">Websites</span>
              {(d.urls as LoginItem['urls']).map((u, i) => (
                <div key={i} className="flex gap-1">
                  <Input
                    aria-label={`Website ${i + 1}`}
                    value={u.url}
                    placeholder="https://example.com"
                    onChange={(e) =>
                      patch({
                        urls: d.urls.map((x: LoginItem['urls'][number], j: number) =>
                          j === i ? { ...x, url: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Select
                    aria-label="Match rule"
                    value={u.match}
                    onChange={(e) =>
                      patch({
                        urls: d.urls.map((x: LoginItem['urls'][number], j: number) =>
                          j === i ? { ...x, match: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="domain">Domain</option>
                    <option value="host">Host</option>
                    <option value="regex">Regex</option>
                    <option value="never">Never</option>
                  </Select>
                  <IconButton
                    label="Remove website"
                    type="button"
                    onClick={() =>
                      patch({ urls: d.urls.filter((_: unknown, j: number) => j !== i) })
                    }
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() => patch({ urls: [...d.urls, { url: '', match: 'domain' }] })}
              >
                <Plus size={14} /> Add website
              </Button>
            </div>
            <Field label="2FA secret key or otpauth:// link">
              {(id) => (
                <Input
                  id={id}
                  value={totpText}
                  autoComplete="off"
                  onChange={(e) => {
                    setTotpText(e.target.value);
                    setError(null);
                  }}
                  className="font-mono"
                />
              )}
            </Field>
          </>
        )}

        {draft.type === 'totp' && (
          <>
            <Field label="Secret key or otpauth:// link">
              {(id) => (
                <Input
                  id={id}
                  value={totpText}
                  autoComplete="off"
                  onChange={(e) => setTotpText(e.target.value)}
                  className="font-mono"
                />
              )}
            </Field>
            <Text
              label="Issuer"
              value={d.totp.issuer}
              onChange={(v) => patch({ totp: { ...d.totp, issuer: v } })}
            />
            <Text
              label="Account"
              value={d.totp.account}
              onChange={(v) => patch({ totp: { ...d.totp, account: v } })}
            />
            <div className="grid grid-cols-3 gap-2">
              <Field label="Algorithm">
                {(id) => (
                  <Select
                    id={id}
                    className="w-full"
                    value={d.totp.algorithm}
                    onChange={(e) => patch({ totp: { ...d.totp, algorithm: e.target.value } })}
                  >
                    <option>SHA1</option>
                    <option>SHA256</option>
                    <option>SHA512</option>
                  </Select>
                )}
              </Field>
              <Field label="Digits">
                {(id) => (
                  <Select
                    id={id}
                    className="w-full"
                    value={d.totp.digits}
                    onChange={(e) => patch({ totp: { ...d.totp, digits: Number(e.target.value) } })}
                  >
                    <option>6</option>
                    <option>7</option>
                    <option>8</option>
                  </Select>
                )}
              </Field>
              <Field label="Period">
                {(id) => (
                  <Select
                    id={id}
                    className="w-full"
                    value={d.totp.period}
                    onChange={(e) => patch({ totp: { ...d.totp, period: Number(e.target.value) } })}
                  >
                    <option>15</option>
                    <option>30</option>
                    <option>60</option>
                  </Select>
                )}
              </Field>
            </div>
          </>
        )}

        {draft.type === 'card' && (
          <>
            <Text label="Cardholder" value={d.holder} onChange={(v) => patch({ holder: v })} />
            <Text label="Number" value={d.number} mono onChange={(v) => patch({ number: v })} />
            <div className="grid grid-cols-3 gap-2">
              <Text label="Expiry" value={d.expiry} onChange={(v) => patch({ expiry: v })} />
              <Text label="CVV" type="password" value={d.cvv} onChange={(v) => patch({ cvv: v })} />
              <Text label="PIN" type="password" value={d.pin} onChange={(v) => patch({ pin: v })} />
            </div>
          </>
        )}

        {draft.type === 'identity' && (
          <>
            <Text label="Full name" value={d.fullName} onChange={(v) => patch({ fullName: v })} />
            <Text
              label="Email"
              type="email"
              value={d.email}
              onChange={(v) => patch({ email: v })}
            />
            <Text label="Phone" value={d.phone} onChange={(v) => patch({ phone: v })} />
            <Text label="Address" value={d.address} onChange={(v) => patch({ address: v })} />
            <Text label="Birthday" value={d.birthday} onChange={(v) => patch({ birthday: v })} />
          </>
        )}

        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              rows={4}
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              className="w-full rounded-lg border border-border bg-bg p-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"
            />
          )}
        </Field>

        {!existing && vaults.length > 1 && (
          <Field label="Vault">
            {(id) => (
              <Select
                id={id}
                className="w-full"
                value={vaultId}
                onChange={(e) => setVaultId(e.target.value)}
              >
                {vaults.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.meta.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(e) => patch({ favorite: e.target.checked })}
          />{' '}
          Favourite
        </label>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}
