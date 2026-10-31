import {
  Fingerprint,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, ErrorText, Field, Input, Select, Switch } from '../components/ui';
import { requestOk } from '../lib/api';
import { db } from '../lib/db';
import { useAsyncAction, type Status } from '../lib/hooks';
import { updateSettings, type Settings } from '../lib/settings';
import { syncOnce } from '../lib/sync';
import { changePassword, lock, setPin, signOut, WrongPasswordError } from '../lib/vault';
import { clearPinBlob } from '../lib/session';
import { useLiveQuery } from 'dexie-react-hooks';

interface Device {
  id: string;
  name: string;
  platform: string;
  lastSeen: number;
  current: boolean;
}

const LF = String.fromCharCode(10);
const lines = (v: string) => [
  ...new Set(
    v
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean),
  ),
];

const SECTION_ICON: Record<string, LucideIcon> = {
  Account: UserRound,
  Security: ShieldCheck,
  'Autofill & passkeys': Fingerprint,
  Appearance: Palette,
  Devices: MonitorSmartphone,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const Icon = SECTION_ICON[title] ?? ShieldCheck;
  return (
    <section className="glass space-y-3 rounded-2xl p-4 text-sm">
      <h3 className="flex items-center gap-2 text-xs font-bold tracking-wider text-muted uppercase">
        <span className="brand-bg grid size-6 place-items-center rounded-lg">
          <Icon size={13} />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAsyncAction();
  if (!open)
    return (
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        Change master password
      </Button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          async () => {
            if (next.length < 12) throw new Error('Use at least 12 characters.');
            await changePassword(cur, next);
            setDone(true);
            setCur('');
            setNext('');
          },
          (e) =>
            e instanceof WrongPasswordError
              ? 'Current password is wrong.'
              : e instanceof Error
                ? e.message
                : 'Failed',
        );
      }}
    >
      <Field label="Current password">
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
          />
        )}
      </Field>
      <Field label="New password">
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        )}
      </Field>
      <ErrorText>{error}</ErrorText>
      {done && <p className="text-xs text-primary">Changed. Other devices must sign in again.</p>}
      <Button type="submit" disabled={busy || !cur || !next}>
        Change password
      </Button>
    </form>
  );
}

export function SettingsTab({ settings, status }: { settings: Settings; status: Status }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pinDraft, setPinDraft] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const sync = useAsyncAction();

  const loadDevices = () =>
    requestOk('GET', '/devices')
      .then((d) => setDevices((d as unknown as Device[]) ?? []))
      .catch(() => setDevices([]));
  useEffect(() => void loadDevices(), []);

  const set = (p: Partial<Settings>) => void updateSettings(p);

  return (
    <div className="fade-in flex-1 space-y-3 overflow-auto px-4 pb-3">
      <Section title="Account">
        <Row label="Signed in as">
          <span className="truncate text-muted" data-testid="account-email">
            {status.email}
          </span>
        </Row>
        <Row label="Server">
          <span className="truncate text-xs text-muted">{settings.serverUrl}</span>
        </Row>
        <Row label={pending ? `${pending} change(s) waiting to sync` : 'Everything synced'}>
          <Button
            variant="secondary"
            disabled={sync.busy}
            onClick={() =>
              void sync.run(async () => {
                const r = await syncOnce();
                setSyncMsg(
                  r.error
                    ? `Sync incomplete (${r.error})`
                    : `Synced · ${r.pushed} sent, ${r.pulled} received`,
                );
              })
            }
          >
            Sync now
          </Button>
        </Row>
        {syncMsg && (
          <p className="text-xs text-muted" role="status">
            {syncMsg}
          </p>
        )}
      </Section>

      <Section title="Security">
        <Row label="Auto-lock">
          <Select
            aria-label="Auto-lock"
            value={settings.autoLockMinutes}
            onChange={(e) => set({ autoLockMinutes: Number(e.target.value) })}
          >
            <option value={1}>1 minute</option>
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={60}>1 hour</option>
            <option value={0}>Browser close only</option>
          </Select>
        </Row>
        <Row label="Clear clipboard">
          <Select
            aria-label="Clear clipboard"
            value={settings.clipboardClearSeconds}
            onChange={(e) => set({ clipboardClearSeconds: Number(e.target.value) })}
          >
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>1 minute</option>
            <option value={0}>Never</option>
          </Select>
        </Row>
        <Row label="Quick-unlock PIN">
          <Switch
            label="Quick-unlock PIN"
            checked={settings.pinEnabled}
            onChange={(v) => {
              set({ pinEnabled: v });
              if (!v) void clearPinBlob();
            }}
          />
        </Row>
        {settings.pinEnabled && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pinDraft.length >= 4) void setPin(pinDraft).then(() => setPinDraft(''));
            }}
          >
            <Input
              aria-label="New PIN"
              type="password"
              inputMode="numeric"
              placeholder={status.pin ? 'PIN set — enter to change' : 'Choose a PIN (4+ digits)'}
              value={pinDraft}
              onChange={(e) => setPinDraft(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={pinDraft.length < 4}>
              Set
            </Button>
          </form>
        )}
        <p className="text-xs text-muted">
          The PIN lives in memory only and is wiped after 5 wrong attempts or when the browser
          closes.
        </p>
        <ChangePassword />
        <Button variant="secondary" className="w-full" onClick={() => void lock()}>
          Lock now
        </Button>
      </Section>

      <Section title="Autofill & passkeys">
        <Row label="Autofill logins">
          <Switch
            label="Autofill logins"
            checked={settings.autofillEnabled}
            onChange={(v) => set({ autofillEnabled: v })}
          />
        </Row>
        <Row label="Handle passkeys">
          <Switch
            label="Handle passkeys"
            checked={settings.passkeysEnabled}
            onChange={(v) => set({ passkeysEnabled: v })}
          />
        </Row>
        <Field label="Never offer to save on (one site per line)">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              defaultValue={settings.neverSave.join(LF)}
              onBlur={(e) => set({ neverSave: lines(e.target.value) })}
              className="w-full rounded-xl border border-border bg-surface p-2.5 text-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-0"
            />
          )}
        </Field>
        <Field label="Never use passkeys on (one site per line)">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              defaultValue={settings.passkeyOptOut.join(LF)}
              onBlur={(e) => set({ passkeyOptOut: lines(e.target.value) })}
              className="w-full rounded-xl border border-border bg-surface p-2.5 text-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-0"
            />
          )}
        </Field>
        <p className="text-xs text-muted">
          Shortcut: Ctrl/Cmd+Shift+L fills the login on the current page. Change it in your
          browser's extension shortcut settings.
        </p>
      </Section>

      <Section title="Appearance">
        <Row label="Theme">
          <Select
            aria-label="Theme"
            value={settings.theme}
            onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Row>
        <Row label="Website icons">
          <Switch
            label="Website icons"
            checked={settings.showIcons}
            onChange={(v) => set({ showIcons: v })}
          />
        </Row>
        <p className="text-xs text-muted">
          Icons are fetched directly from each website, never through a third-party service. Turn
          off to avoid contacting those sites from the vault list.
        </p>
        <Row label="Open in a centred window">
          <Switch
            label="Open in a centred window"
            checked={settings.centeredWindow}
            onChange={(v) => set({ centeredWindow: v })}
          />
        </Row>
        <p className="text-xs text-muted">
          Browsers pin the toolbar popup under the button. This opens Voult in a small window in the
          middle of your screen instead.
        </p>
      </Section>

      <Section title="Devices">
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {d.name}
                {d.current ? ' (this device)' : ''}
                <span className="block text-xs text-muted">
                  Last seen {new Date(d.lastSeen).toLocaleString()}
                </span>
              </span>
              {!d.current && (
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => void requestOk('DELETE', `/devices/${d.id}`).then(loadDevices)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <div>
        <Button
          variant="danger"
          className="w-full"
          onClick={() =>
            confirm(
              'Sign out and remove local data from this browser? Unsynced changes will be lost.',
            ) && void signOut()
          }
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
