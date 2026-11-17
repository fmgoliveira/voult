import {
  generateEd25519,
  generatePassword,
  hostUsesKey,
  hostUsesPassword,
  parsePrivateKey,
  publicKeyBlob,
  publicKeyLine,
  serialisePrivateKey,
  sshCommand,
  sshKeyChoices,
  sshKeyFilename,
  SshKeyError,
  aliasMessage,
  takenAliases,
  validateAlias,
  type SshHostItem,
  type SshKeyItem,
} from '@voult/core';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../lib/app-store';
import { copySecret } from '../lib/clipboard';
import { shareKeyFile } from '../lib/ssh-export';
import { ConfirmSheet, Toggle } from './controls';
import { Button, Chip, ErrorText, Field, Glass } from './kit';
import { useTheme } from './theme';

export const KEY_TYPE_LABEL: Record<SshKeyItem['keyType'], string> = {
  ed25519: 'ED25519',
  rsa: 'RSA',
  'ecdsa-p256': 'ECDSA P-256',
  'ecdsa-p384': 'ECDSA P-384',
};

const IMPORT_ERRORS: Record<string, string> = {
  PassphraseRequired: 'This key is protected by a passphrase. Enter it below.',
  WrongPassphrase: 'Wrong passphrase.',
  UnsupportedKeyType:
    'This key type is not supported. Use ed25519, RSA (2048 bits or more) or ECDSA P-256/P-384.',
  RsaTooShort: 'RSA keys must be at least 2048 bits.',
  InvalidKey: 'This does not look like a private key.',
};

/** Generate or import a key, then show what was loaded. */
export function SshKeyFields({
  draft,
  patch,
}: {
  draft: SshKeyItem;
  patch: (p: Record<string, unknown>) => void;
}) {
  const { c } = useTheme();
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
      setError(IMPORT_ERRORS[code] ?? IMPORT_ERRORS.InvalidKey!);
    }
  };

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    const text = await new File(r.assets[0].uri).text();
    setPasted(text);
    load(text, '');
  };

  const setComment = (comment: string) =>
    patch({
      comment,
      publicKey: draft.publicKey
        ? publicKeyLine(publicKeyBlob(draft.publicKey), comment.trim())
        : '',
    });

  if (!draft.privateKey) {
    return (
      <View style={{ gap: 12 }}>
        <Button
          testID="ssh-generate"
          variant="secondary"
          icon="sparkles-outline"
          label="Generate ed25519 key"
          onPress={() => {
            const k = generateEd25519(draft.comment);
            patch({
              keyType: k.keyType,
              privateKey: k.privateKey,
              publicKey: k.publicKey,
              fingerprint: k.fingerprint,
            });
            setError(null);
          }}
        />
        <Field
          testID="ssh-import-text"
          label="…or paste a private key"
          value={pasted}
          onChangeText={(v) => {
            setPasted(v);
            setNeedPass(false);
            setError(null);
          }}
          multiline
          numberOfLines={5}
          autoComplete="off"
          style={{
            minHeight: 110,
            textAlignVertical: 'top',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        />
        <Button
          variant="secondary"
          icon="document-outline"
          label="Choose a key file"
          onPress={() => void pickFile()}
        />
        {needPass ? (
          <Field label="Key passphrase" value={pass} onChangeText={setPass} secret />
        ) : null}
        <Button
          testID="ssh-import"
          variant="secondary"
          label="Import key"
          disabled={!pasted.trim()}
          onPress={() => load(pasted, pass)}
        />
        <ErrorText>{error}</ErrorText>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>TYPE</Text>
          <Text style={{ color: c.foreground }}>{KEY_TYPE_LABEL[draft.keyType]}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>FINGERPRINT</Text>
          <Text
            numberOfLines={1}
            style={{ color: c.foreground, fontFamily: 'monospace', fontSize: 12 }}
          >
            {draft.fingerprint}
          </Text>
        </View>
      </View>
      <Field label="Comment" value={draft.comment} onChangeText={setComment} />
      <Field
        label="Passphrase for exported copies"
        value={draft.passphrase}
        onChangeText={(v) => patch({ passphrase: v })}
        secret
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Toggle
          value={draft.agent.enabled}
          onValueChange={(v) => patch({ agent: { ...draft.agent, enabled: v } })}
          accessibilityLabel="Serve from the Voult SSH agent"
        />
        <Text style={{ flex: 1, color: c.foreground }}>
          Serve from the Voult SSH agent (Windows)
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Toggle
          value={draft.agent.confirm}
          onValueChange={(v) => patch({ agent: { ...draft.agent, confirm: v } })}
          accessibilityLabel="Ask before every signature"
        />
        <Text style={{ flex: 1, color: c.foreground }}>Ask before every signature</Text>
      </View>
      <Button
        variant="ghost"
        label="Replace key"
        onPress={() =>
          patch({ privateKey: '', publicKey: '', fingerprint: '', comment: '', passphrase: '' })
        }
      />
    </View>
  );
}

export function SshHostFields({
  draft,
  patch,
  selfId,
}: {
  draft: SshHostItem;
  patch: (p: Record<string, unknown>) => void;
  selfId?: string;
}) {
  const { c } = useTheme();
  const items = useApp((s) => s.items);
  const aliasError = draft.alias ? validateAlias(draft.alias, takenAliases(items, selfId)) : null;
  const keys = sshKeyChoices(items);
  const [genPassword, setGenPassword] = useState(false);
  return (
    <View style={{ gap: 14 }}>
      <Field
        testID="input-alias"
        label="Alias (what you type after ssh)"
        value={draft.alias}
        onChangeText={(v) => patch({ alias: v })}
      />
      {aliasError ? <ErrorText>{aliasMessage(aliasError)}</ErrorText> : null}
      <Field
        testID="input-hostname"
        label="Host name or address"
        value={draft.hostname}
        placeholder="server.example.com"
        keyboardType="url"
        onChangeText={(v) => patch({ hostname: v })}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 2 }}>
          <Field label="User" value={draft.username} onChangeText={(v) => patch({ username: v })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Port"
            value={String(draft.port)}
            keyboardType="number-pad"
            onChangeText={(v) =>
              patch({ port: Math.min(65535, Math.max(1, Math.trunc(Number(v)) || 22)) })
            }
          />
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>SIGN IN WITH</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['key', 'Key'],
              ['password', 'Password'],
              ['keyAndPassword', 'Key and password'],
            ] as const
          ).map(([v, label]) => (
            <Chip
              key={v}
              label={label}
              active={draft.auth === v}
              onPress={() => patch({ auth: v })}
            />
          ))}
        </View>
      </View>
      {hostUsesKey(draft) ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>KEY</Text>
          {keys.length === 0 ? (
            <Text style={{ color: c.muted }}>No keys yet: add an SSH key first.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {keys.map((k) => (
                <Chip
                  key={k.id}
                  label={k.item.title || k.item.fingerprint}
                  active={draft.keyItemId === k.id}
                  onPress={() => patch({ keyItemId: k.id })}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}
      {hostUsesPassword(draft) ? (
        <View style={{ gap: 8 }}>
          <Field
            testID="input-password"
            label="Password"
            value={draft.password}
            onChangeText={(v) => patch({ password: v })}
            secret
          />
          <Button
            variant="secondary"
            icon="sparkles-outline"
            label="Generate password"
            onPress={() => {
              patch({ password: generatePassword({ length: 24 }) });
              setGenPassword(true);
            }}
          />
          {genPassword ? (
            <Text style={{ color: c.muted, fontSize: 12 }}>
              A new password was filled in. Remember to change it on the server too.
            </Text>
          ) : null}
        </View>
      ) : null}
      <Field
        label="Jump host (alias or user@host)"
        value={draft.proxyJump}
        onChangeText={(v) => patch({ proxyJump: v })}
      />
      <Field
        label="Extra ssh options (one Key value per line)"
        value={draft.extraOptions}
        onChangeText={(v) => patch({ extraOptions: v })}
        multiline
        numberOfLines={3}
        style={{ minHeight: 70, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 13 }}
      />
    </View>
  );
}

/** Termius hand-off for a key: copy the public key, share (or copy) the private key. */
export function SshKeyActions({ item }: { item: SshKeyItem }) {
  const { c } = useTheme();
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [pass, setPass] = useState(item.passphrase);
  const [error, setError] = useState<string | null>(null);

  const share = async (passphrase: string) => {
    try {
      const text = passphrase
        ? serialisePrivateKey(item.privateKey, item.comment, passphrase)
        : item.privateKey;
      await shareKeyFile(sshKeyFilename(item.keyType), text);
      setError(null);
    } catch {
      setError('Could not share this key.');
    }
  };

  return (
    <Glass style={{ padding: 16, gap: 10 }}>
      <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
        USE IN ANOTHER APP (E.G. TERMIUS)
      </Text>
      <Button
        variant="secondary"
        icon="copy-outline"
        label="Copy public key"
        onPress={() => copySecret(item.publicKey, 'Public key copied')}
      />
      <Button
        testID="ssh-share-private"
        icon="share-outline"
        label="Share private key"
        onPress={() => void share('')}
      />
      <Field
        label="Passphrase for an encrypted copy"
        value={pass}
        onChangeText={setPass}
        secret
        hint="Leave empty to share the key unencrypted."
      />
      <Button
        variant="secondary"
        icon="lock-closed-outline"
        label="Share encrypted copy"
        disabled={!pass}
        onPress={() => void share(pass)}
      />
      <Button variant="ghost" label="Copy private key" onPress={() => setConfirmCopy(true)} />
      <ErrorText>{error}</ErrorText>
      <ConfirmSheet
        visible={confirmCopy}
        title="Copy the private key?"
        message="The clipboard is the weakest way to move a key: other apps may be able to read it until it clears. Prefer Share private key. The copy is cleared automatically after the delay set in Settings."
        confirmLabel="Copy anyway"
        destructive
        onClose={() => setConfirmCopy(false)}
        onConfirm={() => copySecret(item.privateKey, 'Private key copied')}
      />
    </Glass>
  );
}

/** Termius hand-off for a host: copy each connection detail. */
export function SshHostActions({ item }: { item: SshHostItem }) {
  const { c } = useTheme();
  return (
    <Glass style={{ padding: 16, gap: 10 }}>
      <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
        USE IN ANOTHER APP (E.G. TERMIUS)
      </Text>
      <Button
        variant="secondary"
        icon="copy-outline"
        label="Copy host name"
        onPress={() => copySecret(item.hostname, 'Host copied')}
      />
      <Button
        variant="secondary"
        icon="copy-outline"
        label="Copy port"
        onPress={() => copySecret(String(item.port), 'Port copied')}
      />
      {item.username ? (
        <Button
          variant="secondary"
          icon="copy-outline"
          label="Copy username"
          onPress={() => copySecret(item.username, 'Username copied')}
        />
      ) : null}
      {item.password ? (
        <Button
          testID="ssh-copy-password"
          variant="secondary"
          icon="key-outline"
          label="Copy password"
          onPress={() => copySecret(item.password, 'Password copied')}
        />
      ) : null}
      <Button
        variant="secondary"
        icon="terminal-outline"
        label="Copy ssh command"
        onPress={() => copySecret(sshCommand(item), 'Command copied')}
      />
    </Glass>
  );
}
