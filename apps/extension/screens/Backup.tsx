import {
  backupErrorMessage,
  openSnapshot,
  parseSnapshot,
  snapshotChecksum,
  type BackupStatus,
  type OpenedSnapshot,
  type Snapshot,
} from '@voult/core';
import { Lock, Mail, Server } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, ErrorText, Field, FileInput, Input, Switch, useToast } from '../components/ui';
import { useAsyncAction } from '../lib/hooks';
import { downloadBytes } from '../lib/recovery-kit';
import { DEFAULT_SERVER_URL } from '../lib/settings';
import { backup, exportEncryptedBackup, restoreFromSnapshot } from '../lib/vault';

const when = (t: number | null) => (t ? new Date(t).toLocaleString() : 'never');

/** Settings → Backup: Google Drive connection, status, "back up now" and a local encrypted file. */
export function BackupPanel() {
  const [st, setSt] = useState<BackupStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const { busy, error, run } = useAsyncAction();
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = () =>
    backup
      .status()
      .then(setSt)
      .catch(() => setSt(null));
  useEffect(() => {
    void load();
    return () => clearInterval(poll.current);
  }, []);

  // After opening Google's consent page, watch for the server to report the connection.
  const watch = () => {
    setConnecting(true);
    let tries = 0;
    clearInterval(poll.current);
    poll.current = setInterval(() => {
      tries++;
      void backup.status().then((s) => {
        setSt(s);
        if (s.connected || tries > 60) {
          clearInterval(poll.current);
          setConnecting(false);
        }
      });
    }, 2000);
  };

  const friendly = (e: unknown) =>
    e instanceof Error && 'code' in e
      ? backupErrorMessage(String((e as { code: unknown }).code))
      : 'Something went wrong.';

  const download = () =>
    void run(async () => {
      const text = await exportEncryptedBackup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadBytes(new TextEncoder().encode(text), `voult-${stamp}.voult`, 'application/json');
    });

  return (
    <>
      {!st ? (
        <p className="text-xs text-muted">Backup status needs a connection to your server.</p>
      ) : !st.available ? (
        <p className="text-xs text-muted">
          This server has no Google credentials. Add them to enable Drive backups (see
          docs/INSTALL.md).
        </p>
      ) : !st.connected ? (
        <>
          <Button
            className="w-full"
            disabled={busy || connecting}
            onClick={() =>
              void run(async () => {
                const { url } = await backup.startGoogle();
                await browser.tabs.create({ url });
                watch();
              }, friendly)
            }
          >
            {connecting ? 'Waiting for Google…' : 'Connect Google Drive'}
          </Button>
          <p className="text-xs text-muted">
            Voult can only see the "Voult Backups" folder it creates. Backups are encrypted: Google
            never sees your data.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Daily backups</span>
            <Switch
              label="Daily backups"
              checked={st.enabled}
              onChange={(v) => void backup.setEnabled(v).then(load)}
            />
          </div>
          <p className="text-xs text-muted" role="status">
            {st.email ? `Drive: ${st.email} · ` : ''}Last backup: {when(st.lastSuccessAt)}
            {st.files.length ? ` · ${st.files.length} kept` : ''}
          </p>
          {st.lastError && (
            <p role="alert" className="text-xs font-semibold text-danger">
              The last backup failed: {backupErrorMessage(st.lastError)}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await backup.run();
                  useToast.getState().show('Backup saved to Google Drive');
                  await load();
                }, friendly).finally(load)
              }
            >
              {busy ? 'Working…' : 'Back up now'}
            </Button>
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() =>
                confirm('Disconnect Google Drive? Existing backups stay in your Drive.') &&
                void backup.disconnect().then(load)
              }
            >
              Disconnect
            </Button>
          </div>
        </>
      )}
      <Button variant="secondary" className="w-full" disabled={busy} onClick={download}>
        Download encrypted backup file
      </Button>
      <ErrorText>{error}</ErrorText>
      <p className="text-xs text-muted">
        A .voult file restores with your master password alone, even if this server is gone.
      </p>
    </>
  );
}

/** Restore a Drive backup or .voult file into a fresh install (new account on the chosen server). */
export function RestoreWizard({ onBack }: { onBack: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [preview, setPreview] = useState<OpenedSnapshot['counts'] | null>(null);
  const { busy, error, run, setError } = useAsyncAction();

  const pick = async (file: File | undefined) => {
    setPreview(null);
    setSnap(null);
    if (!file) return;
    try {
      const s = parseSnapshot(await file.text());
      setSnap(s);
      setEmail(s.email ?? '');
      setError(null);
    } catch {
      setError('That is not a Voult backup file.');
    }
  };

  const check = () =>
    void run(
      async () => {
        try {
          setPreview((await openSnapshot(snap!, { masterPassword: password })).counts);
        } catch {
          throw new Error('Wrong master password, or the backup is damaged.');
        }
      },
      (e) => (e instanceof Error ? e.message : 'Failed'),
    );

  const restore = () =>
    void run(
      async () => {
        await restoreFromSnapshot(snap!, { password, serverUrl, email });
      },
      (e) =>
        e instanceof Error && e.message === 'email_required'
          ? 'Enter the account email.'
          : e instanceof Error
            ? e.message
            : 'Failed',
    );

  return (
    <div className="space-y-3">
      <Field label="Backup file (.voult)">
        {(id) => (
          <FileInput id={id} accept=".voult,.json,application/json" onFile={(f) => void pick(f)} />
        )}
      </Field>
      <p className="text-xs text-muted">
        Download it from your Google Drive "Voult Backups" folder, or use a file you exported.
      </p>
      {snap && (
        <>
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                leading={<Mail size={15} />}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Master password">
            {(id) => (
              <Input
                id={id}
                leading={<Lock size={15} />}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPreview(null);
                }}
              />
            )}
          </Field>
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
        </>
      )}
      <ErrorText>{error}</ErrorText>
      {preview && snap && (
        <p className="rounded-xl bg-primary/10 p-3 text-xs" role="status">
          Backup from {when(snap.createdAt)}: {preview.items} items ({preview.totp} with 2FA,{' '}
          {preview.passkeys} passkeys). Checksum {snapshotChecksum(snap).slice(0, 12)}.
        </p>
      )}
      {snap &&
        (preview ? (
          <Button className="w-full" disabled={busy || !email} onClick={restore}>
            {busy ? 'Restoring…' : 'Restore to this server'}
          </Button>
        ) : (
          <Button className="w-full" disabled={busy || !password} onClick={check}>
            {busy ? 'Checking…' : 'Check backup'}
          </Button>
        ))}
      <button
        type="button"
        className="w-full text-center text-xs font-semibold text-primary hover:underline"
        onClick={onBack}
      >
        Back
      </button>
    </div>
  );
}
