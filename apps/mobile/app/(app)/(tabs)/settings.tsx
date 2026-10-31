import { WrongPasswordError } from '@voult/core';
import { useEffect, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import * as Native from '../../../modules/voult-native';
import { friendlyError, useApp } from '../../../src/lib/app-store';
import { getRuntime } from '../../../src/lib/runtime';
import type { Settings } from '../../../src/lib/settings';
import { useAction } from '../../../src/ui/hooks';
import { ConfirmSheet, OtpInput, Toggle } from '../../../src/ui/controls';
import { Button, Chip, ErrorText, Field, Screen, Section } from '../../../src/ui/kit';
import { useTheme } from '../../../src/ui/theme';

interface Device {
  id: string;
  name: string;
  lastSeen: number;
  current: boolean;
}

const LOCK_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Immediately' },
  { value: 1, label: '1 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 60, label: '1 hour' },
];
const CLIP_OPTIONS = [
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 0, label: 'Never' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <Text style={{ color: c.foreground, fontSize: 16, flexShrink: 1 }}>{label}</Text>
      {children}
    </View>
  );
}

function Choices<T extends number | string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          label={o.label}
          active={value === o.value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

function AutofillSection() {
  const { c } = useTheme();
  const [status, setStatus] = useState(() => Native.autofillStatus());
  // Re-check when the user comes back from Android's settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setStatus(Native.autofillStatus());
    });
    return () => sub.remove();
  }, []);
  return (
    <Section title="Autofill & passkeys">
      <Row label="Autofill in apps and browsers">
        <Text style={{ color: status.autofillEnabled ? c.success : c.muted, fontWeight: '700' }}>
          {status.autofillEnabled ? 'On' : 'Off'}
        </Text>
      </Row>
      <Button
        variant="secondary"
        label={status.autofillEnabled ? 'Autofill settings' : 'Turn on autofill'}
        onPress={() => Native.openAutofillSettings()}
      />
      <Text style={{ color: c.muted, fontSize: 12 }}>
        Choose Voult as your autofill service. In Chrome, also turn on "Autofill using another
        service" in its settings. Suggestions come from your vault as it was when you last unlocked
        Voult; picking one asks you to unlock.
      </Text>
      {status.credentialProviderSupported ? (
        <>
          <Button
            variant="secondary"
            label="Passkeys & password provider"
            onPress={() => Native.openCredentialProviderSettings()}
          />
          <Text style={{ color: c.muted, fontSize: 12 }}>
            Turn on Voult as a provider to save and use passkeys in apps and browsers.
          </Text>
        </>
      ) : (
        <Text style={{ color: c.muted, fontSize: 12 }}>
          Passkeys in other apps need Android 14 or newer. Passwords still autofill on this phone.
        </Text>
      )}
    </Section>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  if (!open)
    return (
      <Button variant="secondary" label="Change master password" onPress={() => setOpen(true)} />
    );
  return (
    <View style={{ gap: 10 }}>
      <Field label="Current password" value={cur} onChangeText={setCur} secret />
      <Field
        label="New password"
        value={next}
        onChangeText={setNext}
        secret
        hint="At least 12 characters."
      />
      <ErrorText>{error}</ErrorText>
      {done && <Text style={{ color: '#16a34a' }}>Changed. Other devices must sign in again.</Text>}
      <Button
        label="Change password"
        busy={busy}
        disabled={!cur || !next}
        onPress={() =>
          void run(
            async () => {
              if (next.length < 12) throw new Error('Use at least 12 characters.');
              await (await getRuntime()).accounts.changePassword(cur, next);
              setDone(true);
              setCur('');
              setNext('');
            },
            (e) =>
              e instanceof WrongPasswordError ? 'Current password is wrong.' : friendlyError(e),
          )
        }
      />
    </View>
  );
}

export default function SettingsTab() {
  const { c } = useTheme();
  const {
    email,
    serverUrl,
    settings,
    quick,
    pendingOps,
    syncing,
    lastSync,
    refresh,
    syncNow,
    updateSettings,
    lock,
  } = useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  const [pinDraft, setPinDraft] = useState('');
  const [signOut, setSignOut] = useState(false);
  const bio = useAction();
  const pin = useAction();

  const loadDevices = () =>
    getRuntime()
      .then((rt) => rt.http.requestOk('GET', '/devices'))
      .then((d) => setDevices((d as unknown as Device[]) ?? []))
      .catch(() => setDevices([]));
  useEffect(() => void loadDevices(), []);

  const set = (p: Partial<Settings>) => void updateSettings(p);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>
        <View style={{ paddingTop: 8, gap: 4 }}>
          <Text
            style={{ color: c.foreground, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}
          >
            Settings
          </Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>Security, sync and appearance</Text>
        </View>
        <Section title="Account">
          <Row label="Signed in as">
            <Text testID="account-email" style={{ color: c.muted }} numberOfLines={1}>
              {email}
            </Text>
          </Row>
          <Row label="Server">
            <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
              {serverUrl}
            </Text>
          </Row>
          <Row label={pendingOps ? `${pendingOps} change(s) waiting to sync` : 'Everything synced'}>
            <Button
              variant="secondary"
              label="Sync now"
              busy={syncing}
              onPress={() => void syncNow()}
            />
          </Row>
          {lastSync?.error ? (
            <Text style={{ color: c.muted, fontSize: 12 }}>
              Last sync incomplete ({lastSync.error}).
            </Text>
          ) : null}
        </Section>

        <Section title="Security">
          <Row label="Biometric unlock">
            <Toggle
              accessibilityLabel="Biometric unlock"
              value={quick.biometric}
              disabled={!quick.biometricAvailable}
              onValueChange={(on) =>
                void bio.run(async () => {
                  const rt = await getRuntime();
                  if (on) {
                    const key = await rt.getAccountKey();
                    if (key) await rt.quick.enableBiometric(key);
                  } else await rt.quick.disableBiometric();
                  await refresh();
                })
              }
            />
          </Row>
          {!quick.biometricAvailable && (
            <Text style={{ color: c.muted, fontSize: 12 }}>
              Set up a fingerprint or face unlock in Android settings first.
            </Text>
          )}
          <ErrorText>{bio.error}</ErrorText>

          <Row label="PIN unlock">
            <Toggle
              accessibilityLabel="PIN unlock"
              value={quick.pin}
              onValueChange={(on) =>
                void pin.run(async () => {
                  if (!on) {
                    await (await getRuntime()).quick.disablePin();
                    await refresh();
                  }
                })
              }
              disabled={!quick.pin}
            />
          </Row>
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {quick.pin ? 'Change your 6-digit PIN' : 'Set a 6-digit PIN'}
          </Text>
          <OtpInput
            accessibilityLabel="New PIN"
            value={pinDraft}
            onChange={setPinDraft}
            disabled={pin.busy}
            onComplete={(code) =>
              void pin.run(async () => {
                const rt = await getRuntime();
                const key = await rt.getAccountKey();
                if (key) await rt.quick.setPin(code, key);
                setPinDraft('');
                await refresh();
              })
            }
          />
          <Text style={{ color: c.muted, fontSize: 12 }}>
            It saves as soon as you enter the sixth digit. Five wrong attempts delete the PIN; you
            then need your master password.
          </Text>
          <ErrorText>{pin.error}</ErrorText>

          <Text style={{ color: c.muted, fontSize: 13 }}>Auto-lock after leaving the app</Text>
          <Choices
            options={LOCK_OPTIONS}
            value={settings.autoLockMinutes}
            onChange={(autoLockMinutes) => set({ autoLockMinutes })}
          />
          <Text style={{ color: c.muted, fontSize: 13 }}>Clear clipboard after</Text>
          <Choices
            options={CLIP_OPTIONS}
            value={settings.clipboardClearSeconds}
            onChange={(clipboardClearSeconds) => set({ clipboardClearSeconds })}
          />
          <Row label="Block screenshots">
            <Toggle
              accessibilityLabel="Block screenshots"
              value={settings.blockScreenshots}
              onValueChange={(blockScreenshots) => set({ blockScreenshots })}
            />
          </Row>
          <ChangePassword />
          <Button
            variant="secondary"
            icon="lock-closed"
            label="Lock now"
            onPress={() => void lock()}
          />
        </Section>

        <AutofillSection />

        <Section title="Appearance">
          <Choices
            options={[
              { value: 'system' as const, label: 'System' },
              { value: 'light' as const, label: 'Light' },
              { value: 'dark' as const, label: 'Dark' },
            ]}
            value={settings.theme}
            onChange={(theme) => set({ theme })}
          />
          <Row label="Website icons">
            <Toggle
              accessibilityLabel="Website icons"
              value={settings.showIcons}
              onValueChange={(showIcons) => set({ showIcons })}
            />
          </Row>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            Icons are fetched directly from each website, never through a third-party service.
          </Text>
        </Section>

        <Section title="Devices">
          {devices.map((d) => (
            <View
              key={d.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.foreground }} numberOfLines={1}>
                  {d.name}
                  {d.current ? ' (this device)' : ''}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  Last seen {new Date(d.lastSeen).toLocaleString()}
                </Text>
              </View>
              {!d.current && (
                <Button
                  variant="ghost"
                  label="Revoke"
                  onPress={() =>
                    void getRuntime()
                      .then((rt) => rt.http.requestOk('DELETE', `/devices/${d.id}`))
                      .then(loadDevices)
                  }
                />
              )}
            </View>
          ))}
        </Section>

        <View style={{ paddingTop: 16 }}>
          <Button variant="danger" label="Sign out" onPress={() => setSignOut(true)} />
          <ConfirmSheet
            visible={signOut}
            title="Sign out?"
            message="This removes the vault from this phone. Unsynced changes will be lost."
            confirmLabel="Sign out"
            destructive
            onClose={() => setSignOut(false)}
            onConfirm={() =>
              void getRuntime()
                .then((rt) => rt.accounts.signOut())
                .then(refresh)
            }
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
