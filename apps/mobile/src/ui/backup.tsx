import {
  ApiError,
  backupErrorMessage,
  openSnapshot,
  parseSnapshot,
  serializeSnapshot,
  snapshotChecksum,
  snapshotFromStore,
  type BackupStatus,
  type OpenedSnapshot,
  type Snapshot,
} from '@voult/core';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { Linking, Text, ToastAndroid, View } from 'react-native';
import { getRuntime } from '../lib/runtime';
import { DEFAULT_SERVER_URL } from '../lib/settings';
import { Toggle } from './controls';
import { useAction } from './hooks';
import { Button, ErrorText, Field } from './kit';
import { useTheme } from './theme';

const when = (t: number | null) => (t ? new Date(t).toLocaleString() : 'never');
const friendly = (e: unknown) =>
  e instanceof ApiError ? backupErrorMessage(e.code) : e instanceof Error ? e.message : 'Failed';

/** Settings → Backup: Google Drive connection, status, "back up now" and an encrypted file. */
export function BackupPanel() {
  const { c } = useTheme();
  const [st, setSt] = useState<BackupStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const { busy, error, run } = useAction();
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = async () => {
    try {
      setSt(await (await getRuntime()).backup.status());
    } catch {
      setSt(null);
    }
  };
  useEffect(() => {
    void load();
    return () => clearInterval(poll.current);
  }, []);

  const watch = () => {
    setConnecting(true);
    let tries = 0;
    clearInterval(poll.current);
    poll.current = setInterval(() => {
      tries++;
      void getRuntime()
        .then((rt) => rt.backup.status())
        .then((s) => {
          setSt(s);
          if (s.connected || tries > 60) {
            clearInterval(poll.current);
            setConnecting(false);
          }
        })
        .catch(() => undefined);
    }, 2000);
  };

  const share = () =>
    void run(async () => {
      const rt = await getRuntime();
      const text = serializeSnapshot(await snapshotFromStore(rt.store));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const file = new File(Paths.cache, `voult-${stamp}.voult`);
      if (file.exists) file.delete();
      file.create();
      file.write(text);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Save encrypted backup',
      });
    });

  const muted = { color: c.muted, fontSize: 12 } as const;
  return (
    <View style={{ gap: 12 }}>
      {!st ? (
        <Text style={muted}>Backup status needs a connection to your server.</Text>
      ) : !st.available ? (
        <Text style={muted}>
          This server has no Google credentials. Add them to enable Drive backups (see
          docs/INSTALL.md).
        </Text>
      ) : !st.connected ? (
        <>
          <Button
            label={connecting ? 'Waiting for Google…' : 'Connect Google Drive'}
            busy={busy || connecting}
            onPress={() =>
              void run(async () => {
                const { url } = await (await getRuntime()).backup.startGoogle();
                await Linking.openURL(url);
                watch();
              }, friendly)
            }
          />
          <Text style={muted}>
            Voult can only see the "Voult Backups" folder it creates. Backups are encrypted: Google
            never sees your data.
          </Text>
        </>
      ) : (
        <>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ color: c.foreground, fontSize: 16 }}>Daily backups</Text>
            <Toggle
              accessibilityLabel="Daily backups"
              value={st.enabled}
              onValueChange={(v) =>
                void getRuntime()
                  .then((rt) => rt.backup.setEnabled(v))
                  .then(load)
              }
            />
          </View>
          <Text style={muted}>
            {st.email ? `Drive: ${st.email} · ` : ''}Last backup: {when(st.lastSuccessAt)}
            {st.files.length ? ` · ${st.files.length} kept` : ''}
          </Text>
          {st.lastError ? (
            <Text
              accessibilityRole="alert"
              style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}
            >
              The last backup failed: {backupErrorMessage(st.lastError)}
            </Text>
          ) : null}
          <Button
            variant="secondary"
            label="Back up now"
            busy={busy}
            onPress={() =>
              void run(async () => {
                try {
                  await (await getRuntime()).backup.run();
                  ToastAndroid.show('Backup saved to Google Drive', ToastAndroid.SHORT);
                } finally {
                  await load();
                }
              }, friendly)
            }
          />
          <Button
            variant="ghost"
            label="Disconnect Google Drive"
            onPress={() =>
              void getRuntime()
                .then((rt) => rt.backup.disconnect())
                .then(load)
            }
          />
        </>
      )}
      <Button variant="secondary" label="Share encrypted backup file" onPress={share} />
      <ErrorText>{error}</ErrorText>
      <Text style={muted}>
        A .voult file restores with your master password alone, even if your server is gone. Google
        Drive appears in the share and file pickers.
      </Text>
    </View>
  );
}

/** Restore a Drive backup or .voult file into a fresh install (new account on the chosen server). */
export function RestoreFlow({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { c } = useTheme();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [counts, setCounts] = useState<OpenedSnapshot['counts'] | null>(null);
  const { busy, error, run, setError } = useAction();

  const pick = () =>
    void run(async () => {
      const r = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (r.canceled || !r.assets[0]) return;
      let s: Snapshot;
      try {
        s = parseSnapshot(await new File(r.assets[0].uri).text());
      } catch {
        throw new Error('That is not a Voult backup file.');
      }
      setSnap(s);
      setCounts(null);
      setEmail(s.email ?? '');
      setError(null);
    });

  const check = () =>
    void run(async () => {
      try {
        setCounts((await openSnapshot(snap!, { masterPassword: password })).counts);
      } catch {
        throw new Error('Wrong master password, or the backup is damaged.');
      }
    });

  const restore = () =>
    void run(
      async () => {
        await (
          await getRuntime()
        ).accounts.restoreFromSnapshot(snap!, {
          password,
          serverUrl,
          email,
        });
        onDone();
      },
      (e) =>
        e instanceof Error && e.message === 'email_required'
          ? 'Enter the account email.'
          : e instanceof Error
            ? e.message
            : 'Failed',
    );

  return (
    <View style={{ gap: 14 }}>
      <Button
        variant="secondary"
        icon="document-outline"
        label={snap ? 'Choose another file' : 'Choose backup file (.voult)'}
        onPress={pick}
      />
      <Text style={{ color: c.muted, fontSize: 12 }}>
        Pick the file from Google Drive's "Voult Backups" folder, or one you exported.
      </Text>
      {snap ? (
        <>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
          />
          <Field
            label="Master password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setCounts(null);
            }}
            secret
            autoComplete="current-password"
          />
          <Field
            label="Server URL"
            value={serverUrl}
            onChangeText={setServerUrl}
            keyboardType="url"
          />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {counts && snap ? (
        <Text accessibilityRole="summary" style={{ color: c.foreground, fontSize: 13 }}>
          Backup from {when(snap.createdAt)}: {counts.items} items ({counts.totp} with 2FA,{' '}
          {counts.passkeys} passkeys). Checksum {snapshotChecksum(snap).slice(0, 12)}.
        </Text>
      ) : null}
      {snap ? (
        counts ? (
          <Button label="Restore to this server" busy={busy} disabled={!email} onPress={restore} />
        ) : (
          <Button label="Check backup" busy={busy} disabled={!password} onPress={check} />
        )
      ) : null}
      <Button variant="ghost" label="Back" onPress={onBack} />
    </View>
  );
}
