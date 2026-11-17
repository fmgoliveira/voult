import {
  generateEd25519,
  generatePassword,
  hostUsesKey,
  hostUsesPassword,
  parsePrivateKey,
  publicKeyBlob,
  publicKeyLine,
  sshKeyChoices,
  SshKeyError,
  takenAliases,
  validateAlias,
  type AliasError,
  type SshHostItem,
  type SshKeyItem,
} from '@voult/core';
import { Eye, EyeOff, Upload, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Checkbox, Field, IconButton, Input, Select } from '../components/ui';
import type { ItemView } from '../lib/vault';

const ALIAS_MESSAGE: Record<AliasError, string> = {
  empty: 'Enter an alias, the short name you type after ssh.',
  invalid: 'Use only letters, digits, dot, dash and underscore (no leading dash).',
  duplicate: 'Another host already uses this alias.',
};
export const aliasMessage = (e: AliasError): string => ALIAS_MESSAGE[e];

/** Returns an error message for an invalid ssh item draft, or null. */
export function validateSshDraft(
  draft: SshKeyItem | SshHostItem,
  items: ItemView[],
  selfId?: string,
): string | null {
  if (draft.type === 'sshKey') {
    return draft.privateKey ? null : 'Generate or import a private key first.';
  }
  const alias = validateAlias(draft.alias, takenAliases(items, selfId));
  if (alias) return aliasMessage(alias);
  if (!draft.hostname.trim()) return 'Enter the host name or address.';
  if (hostUsesKey(draft) && !draft.keyItemId) return 'Choose which key this host uses.';
  return null;
}

function Secret({
  label,
  value,
  onChange,
  generate,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  generate?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label}>
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
            label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            onClick={() => setShow(!show)}
            type="button"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
          {generate && (
            <IconButton
              label="Generate password"
              onClick={() => {
                onChange(generatePassword({ length: 24 }));
                setShow(true);
              }}
              type="button"
            >
              <Wand2 size={16} />
            </IconButton>
          )}
        </div>
      )}
    </Field>
  );
}

function Plain({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  mono,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={mono ? 'font-mono' : ''}
        />
      )}
    </Field>
  );
}

const KEY_TYPE_LABEL: Record<SshKeyItem['keyType'], string> = {
  ed25519: 'ED25519',
  rsa: 'RSA',
  'ecdsa-p256': 'ECDSA P-256',
  'ecdsa-p384': 'ECDSA P-384',
};
export const keyTypeLabel = (t: SshKeyItem['keyType']): string => KEY_TYPE_LABEL[t];

/** Generate or import a key, then show what was loaded. */
export function SshKeyFields({
  draft,
  patch,
}: {
  draft: SshKeyItem;
  patch: (p: Partial<SshKeyItem>) => void;
}) {
  const [pasted, setPasted] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = (text: string, passphrase: string) => {
    try {
      const k = parsePrivateKey(text, passphrase);
      patch({
        keyType: k.keyType,
        privateKey: k.privateKey,
        publicKey: k.publicKey,
        fingerprint: k.fingerprint,
        comment: k.comment,
        passphrase,
        ...(draft.title ? {} : { title: k.comment }),
      });
      setPasted('');
      setPass('');
      setNeedPass(false);
      setError(null);
    } catch (e) {
      const code = e instanceof SshKeyError ? e.code : 'InvalidKey';
      setNeedPass(code === 'PassphraseRequired' || code === 'WrongPassphrase');
      setError(
        {
          PassphraseRequired: 'This key is protected by a passphrase. Enter it below.',
          WrongPassphrase: 'Wrong passphrase.',
          UnsupportedKeyType:
            'This key type is not supported. Use ed25519, RSA (2048 bits or more) or ECDSA P-256/P-384.',
          RsaTooShort: 'RSA keys must be at least 2048 bits.',
          InvalidKey: 'This does not look like a private key.',
        }[code],
      );
    }
  };

  const hasKey = !!draft.privateKey;
  const setComment = (comment: string) => {
    const publicKey = draft.publicKey
      ? publicKeyLine(publicKeyBlob(draft.publicKey), comment.trim())
      : '';
    patch({ comment, publicKey });
  };

  return (
    <>
      {!hasKey && (
        <div className="space-y-2.5">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              const k = generateEd25519(draft.comment);
              patch({
                keyType: k.keyType,
                privateKey: k.privateKey,
                publicKey: k.publicKey,
                fingerprint: k.fingerprint,
              });
              setError(null);
            }}
          >
            <Wand2 size={15} /> Generate ed25519 key
          </Button>
          <Field label="…or import a private key">
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={pasted}
                spellCheck={false}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                onChange={(e) => {
                  setPasted(e.target.value);
                  setNeedPass(false);
                  setError(null);
                }}
                className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-0"
              />
            )}
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-primary">
            <Upload size={14} />
            Choose a key file
            <input
              type="file"
              className="sr-only"
              data-testid="ssh-key-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then((t) => (setPasted(t), load(t, '')));
                e.target.value = '';
              }}
            />
          </label>
          {needPass && <Secret label="Key passphrase" value={pass} onChange={setPass} />}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={!pasted.trim()}
            onClick={() => load(pasted, pass)}
          >
            Import key
          </Button>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {hasKey && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="font-semibold text-muted">Type</div>
              <div data-testid="ssh-key-type">{keyTypeLabel(draft.keyType)}</div>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-muted">Fingerprint</div>
              <div className="truncate font-mono" data-testid="ssh-key-fingerprint">
                {draft.fingerprint}
              </div>
            </div>
          </div>
          <Plain label="Comment" value={draft.comment} onChange={setComment} />
          <Secret
            label="Passphrase for exported copies"
            value={draft.passphrase}
            onChange={(v) => patch({ passphrase: v })}
          />
          <Checkbox
            checked={draft.agent.enabled}
            onChange={(v) => patch({ agent: { ...draft.agent, enabled: v } })}
            className="text-sm font-medium"
          >
            Serve from the Voult SSH agent (Windows)
          </Checkbox>
          <Checkbox
            checked={draft.agent.confirm}
            onChange={(v) => patch({ agent: { ...draft.agent, confirm: v } })}
            className="text-sm font-medium"
          >
            Ask before every signature
          </Checkbox>
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            onClick={() =>
              patch({
                privateKey: '',
                publicKey: '',
                fingerprint: '',
                comment: '',
                passphrase: '',
              })
            }
          >
            Replace key
          </Button>
        </>
      )}
    </>
  );
}

export function SshHostFields({
  draft,
  patch,
  items,
  selfId,
}: {
  draft: SshHostItem;
  patch: (p: Partial<SshHostItem>) => void;
  items: ItemView[];
  selfId?: string;
}) {
  const aliasError = draft.alias ? validateAlias(draft.alias, takenAliases(items, selfId)) : null;
  const keys = sshKeyChoices(items);
  return (
    <>
      <Field label="Alias (what you type after ssh)">
        {(id) => (
          <Input
            id={id}
            value={draft.alias}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!aliasError}
            onChange={(e) => patch({ alias: e.target.value })}
            className="font-mono"
          />
        )}
      </Field>
      {aliasError && (
        <p role="alert" className="-mt-2 text-xs text-danger">
          {aliasMessage(aliasError)}
        </p>
      )}
      <Plain
        label="Host name or address"
        value={draft.hostname}
        onChange={(v) => patch({ hostname: v })}
        placeholder="server.example.com"
      />
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <Plain label="User" value={draft.username} onChange={(v) => patch({ username: v })} />
        </div>
        <Plain
          label="Port"
          type="number"
          value={draft.port}
          onChange={(v) =>
            patch({ port: Math.min(65535, Math.max(1, Math.trunc(Number(v)) || 22)) })
          }
        />
      </div>
      <Field label="Sign in with">
        {(id) => (
          <Select
            id={id}
            className="w-full"
            value={draft.auth}
            onChange={(e) => patch({ auth: e.target.value as SshHostItem['auth'] })}
          >
            <option value="key">Key</option>
            <option value="password">Password</option>
            <option value="keyAndPassword">Key and password</option>
          </Select>
        )}
      </Field>
      {hostUsesKey(draft) && (
        <Field label="Key">
          {(id) => (
            <Select
              id={id}
              className="w-full"
              value={draft.keyItemId ?? ''}
              onChange={(e) => patch({ keyItemId: e.target.value || undefined })}
            >
              <option value="">
                {keys.length ? 'Choose a key…' : 'No keys yet: add an SSH key first'}
              </option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.item.title || k.item.fingerprint}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {hostUsesPassword(draft) && (
        <Secret
          label="Password"
          value={draft.password}
          onChange={(v) => patch({ password: v })}
          generate
        />
      )}
      <Plain
        label="Jump host (alias or user@host)"
        value={draft.proxyJump}
        onChange={(v) => patch({ proxyJump: v })}
      />
      <Field label="Extra ssh options (one Key value per line)">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={draft.extraOptions}
            spellCheck={false}
            placeholder="ServerAliveInterval 30"
            onChange={(e) => patch({ extraOptions: e.target.value })}
            className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-0"
          />
        )}
      </Field>
    </>
  );
}
